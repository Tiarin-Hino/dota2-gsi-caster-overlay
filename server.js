const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const port = 3002;

app.use(express.static(__dirname));

let damageData = {}; // This object will now store more comprehensive player data
let lastReceivedTimestamp = null;

app.use(bodyParser.json({ limit: '5mb' }));

app.post('/', (req, res) => {
    const now = new Date();
    lastReceivedTimestamp = now;
    const currentGsiPayload = req.body;

    if (currentGsiPayload && currentGsiPayload.map && currentGsiPayload.map.game_state === 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' && currentGsiPayload.player && currentGsiPayload.hero) {

        const newDamageData = {};
        let heroesProcessed = 0;

        for (const teamKey in currentGsiPayload.hero) {
            if (currentGsiPayload.hero.hasOwnProperty(teamKey) && typeof currentGsiPayload.hero[teamKey] === 'object') {
                const heroTeamObject = currentGsiPayload.hero[teamKey];
                const playerTeamObject = currentGsiPayload.player[teamKey];

                for (const playerKey in heroTeamObject) {
                    if (heroTeamObject.hasOwnProperty(playerKey)) {
                        const heroInfo = heroTeamObject[playerKey];
                        const playerInfo = (playerTeamObject && playerTeamObject.hasOwnProperty(playerKey)) ? playerTeamObject[playerKey] : null;

                        // Define conditions based on correct locations
                        const hasHeroInfo = !!heroInfo;
                        const hasValidId = hasHeroInfo && heroInfo.id !== undefined && heroInfo.id !== 0;
                        const hasPlayerInfo = !!playerInfo;
                        // Check for damage in playerInfo (for damage dealt overlay)
                        const hasDamage = hasPlayerInfo && playerInfo.hero_damage !== undefined;
                        const hasTeamName = hasPlayerInfo && !!playerInfo.team_name;

                        // Check if all conditions are met to add player data
                        if (hasHeroInfo && hasValidId && hasPlayerInfo && hasTeamName) { // Simplified check - assume if playerInfo exists, most stats exist
                            heroesProcessed++;
                            // *** COPY MORE DATA FROM playerInfo and heroInfo ***
                            newDamageData[playerKey] = {
                                // Info from hero object
                                heroName: heroInfo.name,
                                heroId: heroInfo.id,
                                level: heroInfo.level, // Example: Add level

                                // Info from player object
                                damage_dealt: playerInfo.hero_damage, // Renamed for clarity
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
                                // --- Include Ward Stats ---
                                wards_placed: playerInfo.wards_placed,
                                wards_destroyed: playerInfo.wards_destroyed,
                                // --- Add other potentially useful stats ---
                                camps_stacked: playerInfo.camps_stacked,
                                runes_activated: playerInfo.runes_activated,
                                // Note: Add checks (like !== undefined) if any field might be missing sometimes
                            };
                        }
                    }
                }
            }
        }

        if (Object.keys(damageData).length !== heroesProcessed && heroesProcessed > 0) {
             console.log(`[${now.toLocaleTimeString()}] Processed ${heroesProcessed} heroes.`);
        } else if (heroesProcessed === 0 && Object.keys(damageData).length > 0){
             // If we suddenly process 0 heroes after having data, log it maybe?
        }
        damageData = newDamageData; // Update the central cache

    } else if (currentGsiPayload && currentGsiPayload.map && currentGsiPayload.map.game_state !== 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS') {
        if (Object.keys(damageData).length > 0) {
            console.log(` --> Game not in progress (State: ${currentGsiPayload.map.game_state}). Resetting damage data.`);
            damageData = {};
        }
    }

    res.status(200).send('OK');
});

// GET /damage_data endpoint (Now serves richer data)
app.get('/damage_data', (req, res) => {
    res.json(damageData);
});

// GET /damage_dealt (Needs slight update to read 'damage_dealt' field)
app.get('/damage_dealt', (req, res) => {
    res.sendFile(path.join(__dirname, 'damage_dealt.html'));
});

// GET /damage_received (Placeholder overlay)
app.get('/damage_received', (req, res) => {
    res.sendFile(path.join(__dirname, 'damage_received.html'));
});

// GET /wards (Should work now)
app.get('/wards', (req, res) => {
    res.sendFile(path.join(__dirname, 'wards.html'));
});


// Start server
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

// Stale data check
setInterval(() => {
    if (lastReceivedTimestamp && (new Date() - lastReceivedTimestamp > 60000)) {
        console.warn("(!) Warning: Haven't received GSI data in the last minute. Is Dota 2 running and sending data to the correct port?");
        lastReceivedTimestamp = null;
    }
}, 30000);