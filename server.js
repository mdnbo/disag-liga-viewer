#!/usr/bin/env node
/**
 * DISAG OpticScore Live-Ergebnis Server
 * 
 * Lauscht auf UDP-Broadcasts der DISAG JSON Live-Schnittstelle (Port 30169)
 * und stellt die Ergebnisse über eine Web-Oberfläche per WebSocket bereit.
 * 
 * Nutzung: node server.js [--udp-port 30169] [--web-port 3000] [--demo]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const { WebSocketServer } = require('./ws-server');

// Prevent unhandled errors from crashing the process
process.on('uncaughtException', (err) => {
  console.error('⚠️  Unerwarteter Fehler (Server läuft weiter):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('⚠️  Unbehandeltes Promise (Server läuft weiter):', err);
});

// --- CLI Arguments ---
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const UDP_PORT = parseInt(getArg('--udp-port', '30169'), 10);
const WEB_PORT = parseInt(getArg('--web-port', '3000'), 10);
const DEMO_MODE = args.includes('--demo');

// --- State ---
const state = {
  // shooters keyed by range number
  ranges: {},
  // match pairings: array of { range1, range2, shooter1, shooter2, ... }
  pairings: [],
  // manual pairing overrides: array of { range1, range2 } or null for auto
  manualPairings: null,
  // team scores
  teams: {},
  // detected discipline
  discipline: null,
  // raw log of last N events
  eventLog: [],
};

const DISC_NAMES = {
  LG: 'Luftgewehr 10m',
  LGA: 'Luftgewehr Auflage 10m',
  LP: 'Luftpistole 10m',
  LPA: 'Luftpistole Auflage 10m',
  KK: 'Kleinkalibergewehr 50m',
  KKA: 'Kleinkalibergewehr Auflage 50m',
  ZS: 'Zimmerstutzen 15m',
  ZSA: 'Zimmerstutzen Auflage 15m',
  ZSTRD: 'Zimmerstutzen Traditionell 15m',
  KYFFH: 'Kyffhäuserscheibe',
  LPS: 'Luftpistole Schnellfeuer 10m',
  LPI: 'Luftpistole 10m',
};

function processMessage(msgObj) {
  try {
    if (msgObj.MessageType !== 'Event') return;

    const verb = msgObj.MessageVerb;
    const range = msgObj.Ranges != null ? (typeof msgObj.Ranges === 'number' ? msgObj.Ranges : msgObj.Ranges) : null;
    const objects = msgObj.Objects || [];

    for (const obj of objects) {
      if (verb === 'Shot' && obj) {
        processShotEvent(range, obj);
      } else if (verb === 'Series' && obj) {
        processSeriesEvent(range, obj);
      } else if (verb === 'Result' && obj) {
        processResultEvent(range, obj);
      } else if (verb === 'Competition' && obj) {
        processCompetitionEvent(range, obj);
      } else if (verb === 'RangeSettings' && obj) {
        processRangeSettings(range, obj);
      }
    }

    // Keep log bounded
    state.eventLog.push({ time: new Date().toISOString(), verb, range, objects });
    if (state.eventLog.length > 500) state.eventLog.shift();
  } catch (e) {
    console.error('Error processing message:', e.message);
  }
}

function getOrCreateRange(rangeNum) {
  if (!state.ranges[rangeNum]) {
    state.ranges[rangeNum] = {
      range: rangeNum,
      shooter: null,
      team: null,
      club: null,
      shots: [],
      series: [],
      totalFull: 0,
      totalDec: 0.0,
      shotCount: 0,
      isShootoff: false,
      shootoffShots: [],
      resultFinished: false,
      discType: null,
      menuItem: null,
    };
  }
  return state.ranges[rangeNum];
}

function processShotEvent(range, shot) {
  const r = getOrCreateRange(range);

  if (shot.Shooter) {
    r.shooter = shot.Shooter;
    if (shot.Shooter.Team) r.team = shot.Shooter.Team;
    if (shot.Shooter.Club) r.club = shot.Shooter.Club;
  }
  if (shot.DiscType) {
    r.discType = shot.DiscType;
    if (!state.discipline && DISC_NAMES[shot.DiscType]) {
      state.discipline = DISC_NAMES[shot.DiscType];
      console.log(`   Disziplin erkannt: ${state.discipline}`);
    }
  }
  if (shot.MenuItem) r.menuItem = shot.MenuItem;

  const shotData = {
    count: shot.Count,
    fullValue: shot.FullValue,
    decValue: shot.DecValue,
    x: shot.X,
    y: shot.Y,
    distance: shot.Distance,
    isValid: shot.IsValid,
    isWarmup: shot.IsWarmup,
    isHot: shot.IsHot,
    isShootoff: shot.IsShootoff,
    isInnerten: shot.IsInnerten,
    run: shot.Run,
    timestamp: shot.ShotDateTime || new Date().toISOString(),
  };

  if (shot.IsWarmup) return; // ignore warmup shots in scoring

  if (shot.IsShootoff) {
    r.isShootoff = true;
    r.shootoffShots.push(shotData);
  } else if (shot.IsHot) {
    r.shots.push(shotData);
    // Recalculate totals from shots
    r.totalFull = r.shots.reduce((s, sh) => s + (sh.fullValue || 0), 0);
    r.totalDec = r.shots.reduce((s, sh) => s + (sh.decValue || 0), 0);
    r.shotCount = r.shots.length;
  }

  updatePairings();
}

function processSeriesEvent(range, series) {
  const r = getOrCreateRange(range);
  if (series.Shooter) {
    r.shooter = series.Shooter;
    if (series.Shooter.Team) r.team = series.Shooter.Team;
    if (series.Shooter.Club) r.club = series.Shooter.Club;
  }
  r.series.push({
    id: series.ID,
    fullValue: series.FullValue,
    decValue: series.DecValue,
    seriesLength: series.SeriesLength || 10,
  });
}

function processResultEvent(range, result) {
  const r = getOrCreateRange(range);
  if (result.Shooter) {
    r.shooter = result.Shooter;
    if (result.Shooter.Team) r.team = result.Shooter.Team;
    if (result.Shooter.Club) r.club = result.Shooter.Club;
  }
  r.totalFull = result.FullValue;
  r.totalDec = result.DecValue;
  r.shotCount = result.ShotCount;
  r.resultFinished = true;
  updatePairings();
}

function processCompetitionEvent(range, comp) {
  // Competition events set up pairings info
  if (comp.Shooter) {
    const r = getOrCreateRange(range);
    r.shooter = comp.Shooter;
    if (comp.Shooter.Team) r.team = comp.Shooter.Team;
    if (comp.Shooter.Club) r.club = comp.Shooter.Club;
  }
}

function processRangeSettings(range, settings) {
  // Store settings if needed
}

function updatePairings() {
  const rangeNums = Object.keys(state.ranges).map(Number).sort((a, b) => a - b);

  // If manual pairings are set, use those
  if (state.manualPairings && state.manualPairings.length > 0) {
    state.pairings = [];
    for (const mp of state.manualPairings) {
      const r1 = state.ranges[mp.range1];
      const r2 = state.ranges[mp.range2];
      if (r1 && r2) {
        state.pairings.push({ range1: mp.range1, range2: mp.range2, shooter1: r1, shooter2: r2 });
      }
    }
  } else {
    // Auto-detect pairings from teams
    const teamRanges = {};
    for (const rn of rangeNums) {
      const r = state.ranges[rn];
      if (r.team && r.team.Name) {
        if (!teamRanges[r.team.Name]) teamRanges[r.team.Name] = [];
        teamRanges[r.team.Name].push(rn);
      }
    }

    state.pairings = [];
    const teamNames = Object.keys(teamRanges);
    if (teamNames.length === 2) {
      const team1Ranges = teamRanges[teamNames[0]].sort((a, b) => a - b);
      const team2Ranges = teamRanges[teamNames[1]].sort((a, b) => a - b);
      const pairCount = Math.min(team1Ranges.length, team2Ranges.length);
      for (let i = 0; i < pairCount; i++) {
        const r1 = state.ranges[team1Ranges[i]];
        const r2 = state.ranges[team2Ranges[i]];
        state.pairings.push({ range1: team1Ranges[i], range2: team2Ranges[i], shooter1: r1, shooter2: r2 });
      }
    } else {
      for (let i = 0; i < rangeNums.length - 1; i += 2) {
        const r1 = state.ranges[rangeNums[i]];
        const r2 = state.ranges[rangeNums[i + 1]];
        state.pairings.push({ range1: rangeNums[i], range2: rangeNums[i + 1], shooter1: r1, shooter2: r2 });
      }
    }
  }

  // Update team scores
  state.teams = {};
  for (const p of state.pairings) {
    const t1Name = p.shooter1.team?.Name || 'Heim';
    const t2Name = p.shooter2.team?.Name || 'Gast';
    if (!state.teams[t1Name]) state.teams[t1Name] = { name: t1Name, points: 0, totalRings: 0 };
    if (!state.teams[t2Name]) state.teams[t2Name] = { name: t2Name, points: 0, totalRings: 0 };

    state.teams[t1Name].totalRings += p.shooter1.totalFull;
    state.teams[t2Name].totalRings += p.shooter2.totalFull;

    // Determine duel winner (only if both have >= 30 shots or result is finished)
    if (p.shooter1.resultFinished && p.shooter2.resultFinished) {
      if (p.shooter1.totalFull > p.shooter2.totalFull) {
        state.teams[t1Name].points += 1;
      } else if (p.shooter2.totalFull > p.shooter1.totalFull) {
        state.teams[t2Name].points += 1;
      }
      // Shootoff: compare shot-by-shot
      // First 3 shots: whole rings. After that: decimals.
      if (p.shooter1.totalFull === p.shooter2.totalFull) {
        const so1 = p.shooter1.shootoffShots;
        const so2 = p.shooter2.shootoffShots;
        const minLen = Math.min(so1.length, so2.length);
        for (let si = 0; si < minLen; si++) {
          const v1 = si < 3 ? (so1[si].fullValue || 0) : (so1[si].decValue || 0);
          const v2 = si < 3 ? (so2[si].fullValue || 0) : (so2[si].decValue || 0);
          if (v1 > v2) { state.teams[t1Name].points += 1; break; }
          if (v2 > v1) { state.teams[t2Name].points += 1; break; }
        }
      }
    }
  }
}

function getClientState() {
  // Only include ranges that have a team assignment (filters out training shooters)
  const filteredRanges = {};
  for (const [k, r] of Object.entries(state.ranges)) {
    if (r.team) filteredRanges[k] = r;
  }
  return {
    ranges: filteredRanges,
    pairings: state.pairings.map(p => ({
      range1: p.range1,
      range2: p.range2,
    })),
    teams: state.teams,
    manualPairings: state.manualPairings !== null,
    discipline: state.discipline,
    demoMode: DEMO_MODE,
    timestamp: new Date().toISOString(),
  };
}

// --- UDP Listener ---
const udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

udpSocket.on('message', (msg, rinfo) => {
  try {
    const text = msg.toString('utf8').trim();
    if (!text) return;
    const parsed = JSON.parse(text);
    processMessage(parsed);
    broadcastToClients();
  } catch (e) {
    // Might be partial or non-JSON
    console.error(`UDP parse error from ${rinfo.address}:${rinfo.port}:`, e.message);
  }
});

udpSocket.on('listening', () => {
  const addr = udpSocket.address();
  console.log(`✅ UDP-Listener aktiv auf Port ${addr.port}`);
  udpSocket.setBroadcast(true);
});

udpSocket.on('error', (err) => {
  console.error('UDP Error:', err.message);
  if (err.code === 'EACCES') {
    console.error('⚠️  Keine Berechtigung für den UDP-Port. Versuche: sudo node server.js');
  }
});

udpSocket.bind(UDP_PORT, '0.0.0.0');

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  console.log(`   HTTP: ${req.method} ${req.url} (von ${req.socket.remoteAddress})`);
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
  } else if (req.url === '/api/state') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(getClientState()));
  } else if (req.url === '/api/reset' && DEMO_MODE) {
    console.log('🔄 Demo-Neustart — Server wird neu gestartet...');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    // Exit with code 1 so Docker restart policy restarts us
    setTimeout(() => process.exit(1), 200);
  } else if (req.url === '/api/reset') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Reset nur im Demo-Modus verfügbar' }));
  } else if (req.url === '/api/pairings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.pairings === null || data.pairings === 'auto') {
          state.manualPairings = null;
          console.log('Paarungen: Automatik wiederhergestellt');
        } else if (Array.isArray(data.pairings)) {
          state.manualPairings = data.pairings.map(p => ({
            range1: Number(p.range1),
            range2: Number(p.range2),
          }));
          console.log(`Paarungen: ${state.manualPairings.length} manuelle Paarungen gesetzt`);
        }
        updatePairings();
        broadcastToClients();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// --- WebSocket ---
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`   WS: Aktive Clients: ${clients.size}`);
  // Send current state immediately
  ws.send(JSON.stringify({ type: 'state', data: getClientState() }));
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`   WS: Client getrennt. Aktive Clients: ${clients.size}`);
  });
});

function broadcastToClients() {
  const msg = JSON.stringify({ type: 'state', data: getClientState() });
  for (const ws of clients) {
    if (ws.readyState !== 1) {
      clients.delete(ws);
      continue;
    }
    ws.send(msg);
  }
}

server.listen(WEB_PORT, '0.0.0.0', () => {
  console.log(`\n🎯 Schützen-Live Ergebnisanzeige`);
  console.log(`   Web-Oberfläche: http://localhost:${WEB_PORT}`);
  console.log(`   UDP-Port:       ${UDP_PORT}`);
  console.log(`   Demo-Modus:     ${DEMO_MODE ? 'AN' : 'AUS'}`);
  console.log(`\n   Zum Stoppen: Strg+C\n`);
});

// --- Demo Mode ---
if (DEMO_MODE) {
  console.log('🎲 Demo-Modus aktiv — simuliere Ligawettkampf...\n');
  runDemo();
}

function runDemo() {
  const shooters = [
    { range: 1, shooter: { Firstname: 'Martin', Lastname: 'Berghaus', Team: { Name: 'SV Grünwald 1', ShortName: 'SVG' }, Club: { Name: 'SV Grünwald', ShortName: 'SVG' } } },
    { range: 2, shooter: { Firstname: 'Dirk', Lastname: 'Osterfeld', Team: { Name: 'TuS Blankenstein 2', ShortName: 'TBL' }, Club: { Name: 'TuS Blankenstein', ShortName: 'TBL' } } },
    { range: 3, shooter: { Firstname: 'Jörg', Lastname: 'Weidmann', Team: { Name: 'SV Grünwald 1', ShortName: 'SVG' }, Club: { Name: 'SV Grünwald', ShortName: 'SVG' } } },
    { range: 4, shooter: { Firstname: 'Uwe', Lastname: 'Holtkamp', Team: { Name: 'TuS Blankenstein 2', ShortName: 'TBL' }, Club: { Name: 'TuS Blankenstein', ShortName: 'TBL' } } },
    { range: 5, shooter: { Firstname: 'Bernd', Lastname: 'Niehoff', Team: { Name: 'SV Grünwald 1', ShortName: 'SVG' }, Club: { Name: 'SV Grünwald', ShortName: 'SVG' } } },
    { range: 6, shooter: { Firstname: 'Klaus', Lastname: 'Reinert', Team: { Name: 'TuS Blankenstein 2', ShortName: 'TBL' }, Club: { Name: 'TuS Blankenstein', ShortName: 'TBL' } } },
    { range: 7, shooter: { Firstname: 'Helmut', Lastname: 'Drawe', Team: { Name: 'SV Grünwald 1', ShortName: 'SVG' }, Club: { Name: 'SV Grünwald', ShortName: 'SVG' } } },
    { range: 8, shooter: { Firstname: 'Wolfgang', Lastname: 'Fehrmann', Team: { Name: 'TuS Blankenstein 2', ShortName: 'TBL' }, Club: { Name: 'TuS Blankenstein', ShortName: 'TBL' } } },
    { range: 9, shooter: { Firstname: 'Norbert', Lastname: 'Sundermann', Team: { Name: 'SV Grünwald 1', ShortName: 'SVG' }, Club: { Name: 'SV Grünwald', ShortName: 'SVG' } } },
    { range: 10, shooter: { Firstname: 'Rainer', Lastname: 'Beckord', Team: { Name: 'TuS Blankenstein 2', ShortName: 'TBL' }, Club: { Name: 'TuS Blankenstein', ShortName: 'TBL' } } },
  ];

  // Pre-generate all 30 shots per shooter for realistic totals (290-300)
  const allShots = {};

  for (const s of shooters) {
    allShots[s.range] = generateRealisticShots(30);
  }

  // Force ranges 1 and 2 to have the exact same total for guaranteed shootoff
  // Copy range 1's shots to range 2, then shuffle so they look different
  allShots[2] = [...allShots[1]];
  for (let i = allShots[2].length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allShots[2][i], allShots[2][j]] = [allShots[2][j], allShots[2][i]];
  }

  function generateRealisticShots(count) {
    // Generate shots that total 290-300 (avg 9.67-10.0 per shot)
    const targetTotal = 290 + Math.floor(Math.random() * 11); // 290-300
    const shots = [];
    let currentTotal = 0;

    for (let i = 0; i < count; i++) {
      const remaining = count - i;
      const needed = targetTotal - currentTotal;
      const avgNeeded = needed / remaining;

      let ring;
      if (avgNeeded >= 9.8) {
        // Need mostly 10s
        ring = Math.random() < 0.85 ? 10 : 9;
      } else if (avgNeeded >= 9.5) {
        // Mix of 10s and 9s
        ring = Math.random() < 0.6 ? 10 : 9;
      } else {
        // Can afford some 9s and rare 8s
        const r = Math.random();
        if (r < 0.4) ring = 10;
        else if (r < 0.9) ring = 9;
        else ring = 8;
      }

      // Clamp: ensure we can still reach target
      const maxRemaining = (remaining - 1) * 10;
      const minNeededNow = needed - maxRemaining;
      if (ring < minNeededNow) ring = Math.min(10, minNeededNow);

      // Don't overshoot
      const minRemaining = (remaining - 1) * 8;
      const maxAllowedNow = needed - minRemaining;
      if (ring > maxAllowedNow) ring = Math.max(8, maxAllowedNow);

      ring = Math.max(8, Math.min(10, ring));
      shots.push(ring);
      currentTotal += ring;
    }
    return shots;
  }

  let shotCounters = {};
  shooters.forEach(s => shotCounters[s.range] = 0);

  function fireShot() {
    const available = shooters.filter(s => shotCounters[s.range] < 30);
    if (available.length === 0) {
      console.log('Demo: Alle 30 Schuss abgegeben.');
      broadcastToClients();
      // Check all duels for ties and fire shootoffs
      setTimeout(() => fireAllShootoffs(), 3000);
      return;
    }

    // Fire 2-3 shots per tick, preferring shooters who are behind
    // This keeps duels roughly in sync and makes series appear faster
    const shotsPerTick = Math.min(available.length, 2 + (Math.random() < 0.4 ? 1 : 0));
    
    // Sort available by shot count ascending — those behind shoot first
    const sorted = [...available].sort((a, b) => shotCounters[a.range] - shotCounters[b.range]);
    // Pick from the front (behind) with some randomness
    const toFire = [];
    const pool = [...sorted];
    for (let i = 0; i < shotsPerTick && pool.length > 0; i++) {
      // 70% chance to pick from the first half (behind), 30% random
      let idx;
      if (Math.random() < 0.7 && pool.length > 1) {
        idx = Math.floor(Math.random() * Math.ceil(pool.length / 2));
      } else {
        idx = Math.floor(Math.random() * pool.length);
      }
      toFire.push(pool.splice(idx, 1)[0]);
    }

    for (const s of toFire) {
      shotCounters[s.range]++;
      const shotIdx = shotCounters[s.range] - 1;
      const ring = allShots[s.range][shotIdx];
      const decValue = ring === 10 ? 10.0 + Math.floor(Math.random() * 10) / 10 : ring + Math.floor(Math.random() * 10) / 10;

      const angle = Math.random() * 2 * Math.PI;
      const dist = (10 - ring) * 250 + Math.random() * 200;

      processMessage({
        MessageType: 'Event',
        MessageVerb: 'Shot',
        Ranges: s.range,
        Objects: [{
          Shooter: s.shooter,
          DiscType: 'LGA',
          Count: shotCounters[s.range],
          FullValue: ring,
          DecValue: parseFloat(decValue.toFixed(1)),
          X: Math.round(Math.cos(angle) * dist),
          Y: Math.round(Math.sin(angle) * dist),
          Distance: parseFloat((dist / 100).toFixed(1)),
          IsValid: true,
          IsWarmup: false,
          IsHot: true,
          IsShootoff: false,
          IsInnerten: ring === 10 && decValue >= 10.5,
          Run: Math.ceil(shotCounters[s.range] / 10),
          ShotDateTime: new Date().toISOString(),
        }],
      });

      // Send series event every 10 shots
      if (shotCounters[s.range] % 10 === 0) {
        const r = state.ranges[s.range];
        const seriesNum = shotCounters[s.range] / 10;
        const seriesShots = r.shots.slice((seriesNum - 1) * 10, seriesNum * 10);
        processMessage({
          MessageType: 'Event',
          MessageVerb: 'Series',
          Ranges: s.range,
          Objects: [{
            Shooter: s.shooter,
            ID: seriesNum,
            FullValue: seriesShots.reduce((sum, sh) => sum + sh.fullValue, 0),
            DecValue: parseFloat(seriesShots.reduce((sum, sh) => sum + sh.decValue, 0).toFixed(1)),
            SeriesLength: 10,
          }],
        });
      }

      // Send Result event when this shooter reaches 30 shots
      if (shotCounters[s.range] === 30) {
        const r = state.ranges[s.range];
        if (r) {
          processMessage({
            MessageType: 'Event',
            MessageVerb: 'Result',
            Ranges: s.range,
            Objects: [{
              Shooter: s.shooter,
              FullValue: r.totalFull,
              DecValue: r.totalDec,
              ShotCount: 30,
            }],
          });
          console.log(`   Schütze ${s.shooter.Firstname} ${s.shooter.Lastname} fertig: ${r.totalFull} Ringe`);
        }
      }
    }

    broadcastToClients();

    const delay = 400 + Math.random() * 800;
    setTimeout(fireShot, delay);
  }

  function fireAllShootoffs() {
    // Find all tied duels
    const tiedDuels = [];
    for (let i = 0; i < shooters.length - 1; i += 2) {
      const r1 = state.ranges[shooters[i].range];
      const r2 = state.ranges[shooters[i + 1].range];
      if (r1 && r2 && r1.resultFinished && r2.resultFinished && r1.totalFull === r2.totalFull) {
        tiedDuels.push({ s1: shooters[i], s2: shooters[i + 1] });
      }
    }

    if (tiedDuels.length === 0) {
      console.log('Demo: Kein Stechen nötig.');
      return;
    }

    console.log(`Demo: Stechen für ${tiedDuels.length} Duell(e)...`);

    // Process shootoffs sequentially
    let duelIdx = 0;
    function nextShootoff() {
      if (duelIdx >= tiedDuels.length) {
        console.log('Demo: Alle Stechen beendet.');
        broadcastToClients();
        return;
      }
      const duel = tiedDuels[duelIdx];
      duelIdx++;
      fireShootoffForDuel(duel.s1, duel.s2, nextShootoff);
    }
    nextShootoff();
  }

  function fireShootoffForDuel(s1Data, s2Data, callback) {
    console.log(`Demo: Stechen Stand ${s1Data.range} vs ${s2Data.range}...`);
    const isDuel1 = s1Data.range === 1 && s2Data.range === 2;

    const allSoShots = [];

    if (isDuel1) {
      // Fixed: 10, 10, 9 vs 10, 10, 9 — all equal shot-by-shot, then 10.8 vs 10.1
      const fixed_s1 = [10, 10, 9];
      const fixed_s2 = [10, 10, 9];
      for (let i = 0; i < 3; i++) {
        allSoShots.push({ range: 1, shooter: s1Data.shooter, fullValue: fixed_s1[i], decValue: parseFloat(fixed_s1[i].toFixed(1)) });
        allSoShots.push({ range: 2, shooter: s2Data.shooter, fullValue: fixed_s2[i], decValue: parseFloat(fixed_s2[i].toFixed(1)) });
      }
      // Phase 2: decimal shot — decisive
      allSoShots.push({ range: 1, shooter: s1Data.shooter, fullValue: 10, decValue: 10.8 });
      allSoShots.push({ range: 2, shooter: s2Data.shooter, fullValue: 10, decValue: 10.1 });
    } else {
      // Random shootoff for other duels — shot-by-shot comparison
      function randomWholeRing() {
        const r = Math.random();
        if (r < 0.55) return 10;
        if (r < 0.90) return 9;
        return 8;
      }
      function randomDecRing() {
        const full = randomWholeRing();
        const dec = Math.floor(Math.random() * 10) / 10;
        return parseFloat((full + dec).toFixed(1));
      }

      // Phase 1: up to 3 shots, stop as soon as one shot differs
      let decided = false;
      for (let i = 0; i < 3 && !decided; i++) {
        const v1 = randomWholeRing();
        const v2 = randomWholeRing();
        allSoShots.push({ range: s1Data.range, shooter: s1Data.shooter, fullValue: v1, decValue: parseFloat(v1.toFixed(1)) });
        allSoShots.push({ range: s2Data.range, shooter: s2Data.shooter, fullValue: v2, decValue: parseFloat(v2.toFixed(1)) });
        if (v1 !== v2) decided = true;
      }
      // Phase 2: if all 3 shots were equal, single decimal shots until decided
      if (!decided) {
        let resolved = false;
        for (let attempt = 0; attempt < 5 && !resolved; attempt++) {
          const d1 = randomDecRing();
          let d2 = randomDecRing();
          allSoShots.push({ range: s1Data.range, shooter: s1Data.shooter, fullValue: Math.floor(d1), decValue: d1 });
          allSoShots.push({ range: s2Data.range, shooter: s2Data.shooter, fullValue: Math.floor(d2), decValue: d2 });
          if (d1 !== d2) resolved = true;
        }
        if (!resolved) {
          allSoShots.push({ range: s1Data.range, shooter: s1Data.shooter, fullValue: 10, decValue: 10.5 });
          allSoShots.push({ range: s2Data.range, shooter: s2Data.shooter, fullValue: 10, decValue: 10.2 });
        }
      }
    }

    let shotNum = 0;
    const phase1Count = 6; // 3 shots per shooter = 6 total alternating
    function fireSoShot() {
      if (shotNum >= allSoShots.length) {
        broadcastToClients();
        setTimeout(callback, 2000);
        return;
      }

      const so = allSoShots[shotNum];
      const angle = Math.random() * 2 * Math.PI;
      const dist = (10 - so.fullValue) * 250 + Math.random() * 200;

      processMessage({
        MessageType: 'Event',
        MessageVerb: 'Shot',
        Ranges: so.range,
        Objects: [{
          Shooter: so.shooter,
          DiscType: 'LGA',
          Count: 30 + Math.ceil((shotNum + 1) / 2),
          FullValue: so.fullValue,
          DecValue: so.decValue,
          X: Math.round(Math.cos(angle) * dist),
          Y: Math.round(Math.sin(angle) * dist),
          Distance: parseFloat((dist / 100).toFixed(1)),
          IsValid: true,
          IsWarmup: false,
          IsHot: false,
          IsShootoff: true,
          IsInnerten: so.decValue >= 10.5,
          Run: 4,
          ShotDateTime: new Date().toISOString(),
        }],
      });

      broadcastToClients();
      shotNum++;

      // Longer pause between phase 1 and phase 2
      let delay = 1200;
      if (shotNum === phase1Count && shotNum < allSoShots.length) {
        delay = 3000; // 3s pause before decimal shots start
      }
      setTimeout(fireSoShot, delay);
    }

    fireSoShot();
  }

  setTimeout(fireShot, 800);
}
