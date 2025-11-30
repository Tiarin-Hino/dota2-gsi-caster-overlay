const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const port = 3002;

// Serve static files (like images) from the script's directory
app.use(express.static(__dirname));

// --- State Variables ---
// Damage/Stats data
let damageData = {};
let playerState = {}; // Format: { playerKey: { previousHealth: null, damageReceived: 0 } }

// Courier data
let previousCourierState = {};
let activeDeliveries = {};

let lastReceivedTimestamp = null;
// --- End State Variables ---

app.use(bodyParser.json({ limit: '5mb' }));

// Helper function for courier tracking
function slotToPlayerKey(slot) {
    if (slot >= 0 && slot <= 9) {
        return `player${slot}`;
    }
    return null;
}

// Check if game is active (in progress or pre-game phase)
function isGameActive(gameState) {
    return gameState === 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' ||
           gameState === 'DOTA_GAMERULES_STATE_PRE_GAME';
}

app.post('/', (req, res) => {
    const now = new Date();
    lastReceivedTimestamp = now;
    const currentGsiPayload = req.body;
    const gameState = currentGsiPayload?.map?.game_state;
    const gameInProgress = isGameActive(gameState);

    // ==========================================
    // DAMAGE & STATS PROCESSING
    // ==========================================
    if (gameInProgress && currentGsiPayload.player && currentGsiPayload.hero) {
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

                        if (heroInfo && heroInfo.id !== undefined && heroInfo.id !== 0 && playerInfo && playerInfo.team_name) {
                            // Calculate Damage Received (Approximate)
                            const currentHealth = heroInfo.health;
                            let accumulatedDamageReceived = 0;

                            if (!playerState[playerKey]) {
                                playerState[playerKey] = { previousHealth: null, damageReceived: 0 };
                            }
                            const state = playerState[playerKey];

                            if (state.previousHealth !== null && currentHealth !== undefined) {
                                const healthDiff = state.previousHealth - currentHealth;
                                if (healthDiff > 0) {
                                    state.damageReceived += healthDiff;
                                }
                            }

                            if (currentHealth !== undefined) {
                                state.previousHealth = currentHealth;
                            }
                            accumulatedDamageReceived = state.damageReceived;

                            heroesProcessed++;
                            newDamageData[playerKey] = {
                                heroName: heroInfo.name,
                                heroId: heroInfo.id,
                                level: heroInfo.level,
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
                                damage_received: accumulatedDamageReceived
                            };
                        }
                    }
                }
            }
        }

        if (heroesProcessed > 0) {
            if (Object.keys(damageData).length !== heroesProcessed) {
                console.log(`[${now.toLocaleTimeString()}] Processed ${heroesProcessed} heroes.`);
            }
            damageData = newDamageData;
        }
    }

    // ==========================================
    // COURIER PROCESSING
    // ==========================================
    if (gameInProgress && currentGsiPayload.couriers && currentGsiPayload.hero && currentGsiPayload.player) {
        const currentCouriers = currentGsiPayload.couriers;
        const previousData = currentGsiPayload.previously;
        const deliveryIdCounter = now.getTime();
        let currentCourierStateThisTick = {};

        // Process Current Courier States and Detect New Items
        for (const courierId in currentCouriers) {
            if (currentCouriers.hasOwnProperty(courierId)) {
                const courier = currentCouriers[courierId];
                const courierItems = courier.items || {};
                const ownerSlot = courier.owner;
                const ownerPlayerKey = slotToPlayerKey(ownerSlot);
                const isAlive = courier.alive === undefined ? true : courier.alive;

                let currentItemsList = [];
                let currentItemsCount = {};
                for (const itemSlot in courierItems) {
                    if (courierItems.hasOwnProperty(itemSlot) && courierItems[itemSlot].name !== 'empty') {
                        const itemName = courierItems[itemSlot].name;
                        currentItemsList.push({ name: itemName });
                        currentItemsCount[itemName] = (currentItemsCount[itemName] || 0) + 1;
                    }
                }

                currentCourierStateThisTick[courierId] = {
                    owner: ownerSlot,
                    items: currentItemsCount,
                    itemNamesList: Object.keys(currentItemsCount),
                    alive: isAlive
                };

                const prevCourier = previousCourierState[courierId];
                const prevItemNames = new Set(prevCourier?.itemNamesList || []);
                const newItemNames = currentCourierStateThisTick[courierId].itemNamesList.filter(name => !prevItemNames.has(name));

                // If new items appeared and no active delivery for this courier
                if (newItemNames.length > 0 && !Object.values(activeDeliveries).some(d => d.courierId === courierId)) {
                    const deliveryId = `${courierId}-${deliveryIdCounter}`;
                    let heroName = 'unknown_hero';
                    let teamKeyForHero = null;
                    if (currentGsiPayload.hero.team2 && currentGsiPayload.hero.team2[ownerPlayerKey]) teamKeyForHero = 'team2';
                    else if (currentGsiPayload.hero.team3 && currentGsiPayload.hero.team3[ownerPlayerKey]) teamKeyForHero = 'team3';
                    if (teamKeyForHero && currentGsiPayload.hero[teamKeyForHero][ownerPlayerKey]) {
                        heroName = currentGsiPayload.hero[teamKeyForHero][ownerPlayerKey].name;
                    }

                    activeDeliveries[deliveryId] = {
                        deliveryId: deliveryId,
                        courierId: courierId,
                        ownerPlayerKey: ownerPlayerKey,
                        items: currentItemsList,
                        startTime: now.getTime(),
                        heroName: heroName,
                        courierAlive: isAlive
                    };
                    console.log(`[${now.toLocaleTimeString()}] Courier delivery started: ${heroName}`);
                } else if (activeDeliveries[Object.keys(activeDeliveries).find(id => activeDeliveries[id].courierId === courierId)]) {
                    const existingDeliveryId = Object.keys(activeDeliveries).find(id => activeDeliveries[id].courierId === courierId);
                    if (existingDeliveryId && activeDeliveries[existingDeliveryId].courierAlive !== isAlive) {
                        activeDeliveries[existingDeliveryId].courierAlive = isAlive;
                        console.log(`[${now.toLocaleTimeString()}] Courier ${isAlive ? 'respawned' : 'died'}`);
                    }
                }
            }
        }

        // Check if any active deliveries have ended
        const deliveryIdsToRemove = [];
        if (previousData && previousData.couriers) {
            for (const deliveryId in activeDeliveries) {
                const delivery = activeDeliveries[deliveryId];
                const prevCourierData = previousData.couriers[delivery.courierId];
                if (prevCourierData && prevCourierData.items) {
                    let itemLeftCourier = false;
                    for (const itemToCheck of delivery.items) {
                        let foundInPrevious = false;
                        for (const prevItemSlot in prevCourierData.items) {
                            if (prevCourierData.items[prevItemSlot].name === itemToCheck.name) {
                                foundInPrevious = true;
                                break;
                            }
                        }
                        if (foundInPrevious) {
                            let foundInCurrent = false;
                            const currentItemsOnThisCourier = currentCourierStateThisTick[delivery.courierId]?.itemNamesList || [];
                            if (currentItemsOnThisCourier.includes(itemToCheck.name)) {
                                foundInCurrent = true;
                            }
                            if (!foundInCurrent) {
                                itemLeftCourier = true;
                                break;
                            }
                        }
                    }
                    if (itemLeftCourier) {
                        deliveryIdsToRemove.push(deliveryId);
                    }
                }
            }
        }
        deliveryIdsToRemove.forEach(id => {
            if (activeDeliveries[id]) {
                console.log(`[${now.toLocaleTimeString()}] Courier delivery completed`);
                delete activeDeliveries[id];
            }
        });

        previousCourierState = currentCourierStateThisTick;
    }

    // ==========================================
    // RESET STATE IF GAME NOT IN PROGRESS
    // ==========================================
    if (!gameInProgress && currentGsiPayload?.map) {
        const hasData = Object.keys(damageData).length > 0 ||
                        Object.keys(playerState).length > 0 ||
                        Object.keys(activeDeliveries).length > 0 ||
                        Object.keys(previousCourierState).length > 0;

        if (hasData) {
            console.log(`[${now.toLocaleTimeString()}] Game ended (${gameState}). Resetting all data.`);
            damageData = {};
            playerState = {};
            activeDeliveries = {};
            previousCourierState = {};
        }
    }

    res.status(200).send('OK');
});

// --- Endpoints ---

// Damage/Stats endpoints
app.get('/damage_data', (req, res) => {
    res.json(damageData);
});

app.get('/damage_dealt', (req, res) => {
    res.sendFile(path.join(__dirname, 'damage_dealt.html'));
});

app.get('/damage_received', (req, res) => {
    res.sendFile(path.join(__dirname, 'damage_received.html'));
});

app.get('/wards', (req, res) => {
    res.sendFile(path.join(__dirname, 'wards.html'));
});

// Courier endpoints
app.get('/delivery_data', (req, res) => {
    res.json(Object.values(activeDeliveries));
});

app.get('/courier_items', (req, res) => {
    res.sendFile(path.join(__dirname, 'courier_items.html'));
});

// --- Server Start ---
app.listen(port, () => {
    console.log(`------------------------------------------------------`);
    console.log(`Dota 2 GSI Caster Overlay running at http://localhost:${port}`);
    console.log(`------------------------------------------------------`);
    console.log(`Overlays:`);
    console.log(`  - Damage Dealt:    http://localhost:${port}/damage_dealt`);
    console.log(`  - Damage Received: http://localhost:${port}/damage_received`);
    console.log(`  - Wards:           http://localhost:${port}/wards`);
    console.log(`  - Courier Items:   http://localhost:${port}/courier_items`);
    console.log(`------------------------------------------------------`);
    console.log('Waiting for Dota 2 game data...');
});

// Stale data check
setInterval(() => {
    if (lastReceivedTimestamp && (new Date() - lastReceivedTimestamp > 60000)) {
        console.warn("(!) Warning: No GSI data received in the last minute.");
        lastReceivedTimestamp = null;
    }
}, 30000);
