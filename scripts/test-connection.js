#!/usr/bin/env node
/* Standalone connection test for MMM-MusicAssistant.
 *
 * Connects to your real Music Assistant server, authenticates, lists players
 * and queues, and prints the resolved now-playing payload (incl. image URL).
 * Use it to confirm your serverUrl/token/player config before adding the module
 * to MagicMirror.
 *
 * Usage:
 *   node scripts/test-connection.js --url http://192.168.1.50:8095 --token XXX [--player "Living Room"]
 *   MASS_URL=... MASS_TOKEN=... node scripts/test-connection.js
 */

const MaSocket = require("../MaSocket.js");
const MaState = require("../MaState.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const serverUrl = arg("url", process.env.MASS_URL || "http://localhost:8095");
const token = arg("token", process.env.MASS_TOKEN || "");
const player = arg("player", process.env.MASS_PLAYER || "");
const imageSize = Number(arg("size", "512"));

(async () => {
  const socket = new MaSocket({ serverUrl, token, log: (m) => console.log(`[ma] ${m}`) });

  try {
    await socket.connect();
    const [players, queues] = await Promise.all([
      socket.sendCommand("players/all"),
      socket.sendCommand("player_queues/all")
    ]);

    console.log(`\nPlayers (${players.length}):`);
    for (const p of players) {
      console.log(`  - ${p.display_name || p.name} [${p.player_id}] state=${p.state}`);
    }
    console.log(`\nQueues (${queues.length}):`);
    for (const q of queues) {
      console.log(`  - ${q.display_name} [${q.queue_id}] state=${q.state} items=${q.items}`);
    }

    const queue = MaState.resolveQueue(players, queues, player);
    const payload = MaState.buildPayload(queue, {
      showNextUp: true,
      maxNextUp: 3,
      imageSize,
      serverInfo: socket.serverInfo,
      preferredBase: serverUrl
    });
    console.log("\nResolved NOW_PLAYING payload:");
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("ERROR:", err.message || err);
    process.exitCode = 1;
  } finally {
    socket.close();
    process.exit(process.exitCode || 0);
  }
})();
