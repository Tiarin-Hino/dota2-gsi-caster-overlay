const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const port = 3002;

// Serve static files (like images) from the script's directory
app.use(express.static(__dirname));

// --- State Variables ---
// damageData: Holds the comprehensive data packet sent to overlays
let damageData = {};
// playerState: Stores previous health and accumulated received damage
let playerState = {}; // Format: { playerKey: { previousHealth: null, damageReceived: 0 } }
let lastReceivedTimestamp = null;
// --- End State Variables ---

app.use(bodyParser.json({ limit: '5mb' }));

app.post('/', (req, res) => {
    const now = new Date();
    lastReceivedTimestamp = now;
    const currentGsiPayload = req.body;
    let gameInProgress = false;

    // Determine game state first using optional chaining for safety
    if (currentGsiPayload?.map?.game_state === 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS') {
        gameInProgress = true;
    }

    // Process data only if game is in progress and required objects exist
    if (gameInProgress && currentGsiPayload.player && currentGsiPayload.hero) {
        const newDamageData = {}; // Temporary object for this cycle's output data
        let heroesProcessed = 0;

        // Iterate through teams and players
        for (const teamKey in currentGsiPayload.hero) {
            if (currentGsiPayload.hero.hasOwnProperty(teamKey) && typeof currentGsiPayload.hero[teamKey] === 'object') {
                const heroTeamObject = currentGsiPayload.hero[teamKey];
                const playerTeamObject = currentGsiPayload.player[teamKey];

                for (const playerKey in heroTeamObject) {
                    if (heroTeamObject.hasOwnProperty(playerKey)) {
                        const heroInfo = heroTeamObject[playerKey];
                        const playerInfo = (playerTeamObject && playerTeamObject.hasOwnProperty(playerKey)) ? playerTeamObject[playerKey] : null;

                        // Check if basic info is valid
                        if (heroInfo && heroInfo.id !== undefined && heroInfo.id !== 0 && playerInfo && playerInfo.team_name) {

                            // --- Calculate Damage Received (Approximate) ---
                            const currentHealth = heroInfo.health;
                            let accumulatedDamageReceived = 0;

                            // Initialize state for this player if it doesn't exist
                            if (!playerState[playerKey]) {
                                playerState[playerKey] = { previousHealth: null, damageReceived: 0 };
                            }
                            const state = playerState[playerKey];

                            // Calculate diff if we have previous health AND current health is valid
                            if (state.previousHealth !== null && currentHealth !== undefined) {
                                const healthDiff = state.previousHealth - currentHealth;
                                // Only accumulate if health decreased (positive diff)
                                // Basic check - doesn't account for healing exceeding damage between ticks etc.
                                if (healthDiff > 0) {
                                    state.damageReceived += healthDiff;
                                }
                            }

                            // Update previous health only if currentHealth is valid
                            if (currentHealth !== undefined) {
                                state.previousHealth = currentHealth;
                            }
                            // Get the accumulated value for the output data
                            accumulatedDamageReceived = state.damageReceived;
                            // --- End Damage Received Calculation ---

                            heroesProcessed++;
                            // Build the comprehensive data packet for this player
                            newDamageData[playerKey] = {
                                // Hero Info
                                heroName: heroInfo.name,
                                heroId: heroInfo.id,
                                level: heroInfo.level,

                                // Player Info (Direct GSI Stats)
                                damage_dealt: playerInfo.hero_damage,
                                team: playerInfo.team_name,
                                gpm: playerInfo.gpm,
                                xpm: playerInfo.xpm,
                                kills: playerInfo.kills,
                                deaths: playerInfo.deaths,
                                assists: playerInfo.assists,
                                last_hits: playerInfo.last_hits,
                                denies: playerInfo.denies,
                                net_worth: playerInfo.net_worth,
                                hero_healing: playerInfo.hero_healing,
                                wards_placed: playerInfo.wards_placed,
                                wards_destroyed: playerInfo.wards_destroyed,
                                camps_stacked: playerInfo.camps_stacked,
                                runes_activated: playerInfo.runes_activated,

                                // Calculated Stats
                                damage_received: accumulatedDamageReceived // <<< ADDED CALCULATED VALUE
                            };
                        }
                    }
                }
            }
        }

        // Update the main data object only if heroes were processed
        if (heroesProcessed > 0) {
            if (Object.keys(damageData).length !== heroesProcessed) {
                console.log(`[${now.toLocaleTimeString()}] Processed ${heroesProcessed} heroes. (State Initialized/Changed)`);
            }
            damageData = newDamageData; // Update the data served to overlays
        }

    } else if (currentGsiPayload?.map) { // Check map exists before accessing state
        // If game is NOT in progress, reset everything
        const currentGameState = currentGsiPayload.map.game_state;
        // Reset only if not already empty to avoid spamming logs
        if (!gameInProgress && (Object.keys(damageData).length > 0 || Object.keys(playerState).length > 0)) {
            console.log(` --> Game state is ${currentGameState}. Resetting all overlay data and state.`);
            damageData = {}; // Clear output data
            playerState = {}; // <<< Reset stored health/damage received state >>>
        }
    }

    res.status(200).send('OK');
});

// --- Endpoints ---

// GET /damage_data (Serves the combined data)
app.get('/damage_data', (req, res) => {
    res.json(damageData);
});

// GET /damage_dealt
app.get('/damage_dealt', (req, res) => {
    res.sendFile(path.join(__dirname, 'damage_dealt.html'));
});

// GET /damage_received
app.get('/damage_received', (req, res) => {
    res.sendFile(path.join(__dirname, 'damage_received.html'));
});

// GET /wards
app.get('/wards', (req, res) => {
    res.sendFile(path.join(__dirname, 'wards.html'));
});

// --- Server Start & Health Check ---

app.listen(port, () => {
    console.log(`------------------------------------------------------`);
    console.log(`Dota 2 Damage GSI Listener running at http://localhost:${port}`);
    console.log(`Damage Dealt Overlay available at http://localhost:${port}/damage_dealt`);
    console.log(`Damage Received Overlay available at http://localhost:${port}/damage_received`);
    console.log(`Wards Overlay available at http://localhost:${port}/wards`);
    console.log(`------------------------------------------------------`);
    console.log('Waiting for Dota 2 game data...');
    console.log('Ensure Dota 2 is running and you are IN a match/spectating.');
});

// Stale data check remains the same
setInterval(() => {
    if (lastReceivedTimestamp && (new Date() - lastReceivedTimestamp > 60000)) {
        console.warn("(!) Warning: Haven't received GSI data in the last minute. Is Dota 2 running and sending data to the correct port?");
        lastReceivedTimestamp = null;
    }
}, 30000);