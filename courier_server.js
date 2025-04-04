// console.log(JSON.stringify(req.body, null, 2)); // Log the entire payload
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const port = 3003;

// --- State Variables ---
let previousCourierState = {};
let activeDeliveries = {};
let lastReceivedTimestamp = null;
// --- End State Variables ---

app.use(express.static(__dirname));
app.use(bodyParser.json({ limit: '5mb' }));

function slotToPlayerKey(slot) { /* ... same as before ... */ if (slot >= 0 && slot <= 9) { return `player${slot}`; } return null; }

app.post('/', (req, res) => {
    const now = new Date();
    lastReceivedTimestamp = now;
    const currentGsiPayload = req.body;
    let gameInProgress = false;
    const deliveryIdCounter = now.getTime();

    if (currentGsiPayload?.map?.game_state === 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS') {
        gameInProgress = true;
    }

    if (gameInProgress && currentGsiPayload.couriers && currentGsiPayload.hero && currentGsiPayload.player) {
        const currentCouriers = currentGsiPayload.couriers;
        const previousData = currentGsiPayload.previously;
        let currentCourierStateThisTick = {};

        // --- Step 1: Process Current Courier States and Detect New Items ---
        for (const courierId in currentCouriers) {
            if (currentCouriers.hasOwnProperty(courierId)) {
                const courier = currentCouriers[courierId];
                const courierItems = courier.items || {};
                const ownerSlot = courier.owner;
                const ownerPlayerKey = slotToPlayerKey(ownerSlot);
                // *** Extract alive status ***
                const isAlive = courier.alive === undefined ? true : courier.alive; // Default to true if undefined? Check payload again if needed. Assuming 'false' means dead.

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
                    alive: isAlive // Store current alive status
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
                    if (teamKeyForHero && currentGsiPayload.hero[teamKeyForHero][ownerPlayerKey]) heroName = currentGsiPayload.hero[teamKeyForHero][ownerPlayerKey].name;

                    activeDeliveries[deliveryId] = {
                        deliveryId: deliveryId, courierId: courierId, ownerPlayerKey: ownerPlayerKey,
                        items: currentItemsList, startTime: now.getTime(), heroName: heroName,
                        courierAlive: isAlive // <<< Include alive status on creation
                    };
                    console.log(`[${now.toLocaleTimeString()}] Started tracking delivery ${deliveryId} (Courier: ${courierId}, Owner: ${ownerPlayerKey}/${heroName}, Alive: ${isAlive})`);
                } else if (activeDeliveries[Object.keys(activeDeliveries).find(id => activeDeliveries[id].courierId === courierId)]) {
                    // If delivery is already active for this courier, update its alive status
                    const existingDeliveryId = Object.keys(activeDeliveries).find(id => activeDeliveries[id].courierId === courierId);
                    if (existingDeliveryId && activeDeliveries[existingDeliveryId].courierAlive !== isAlive) {
                        activeDeliveries[existingDeliveryId].courierAlive = isAlive;
                        console.log(`[${now.toLocaleTimeString()}] Updated courier ${courierId} alive status to ${isAlive} for delivery ${existingDeliveryId}`);
                    }
                }
            }
        }

        // --- Step 2: Check if any active deliveries have ended using 'previously' ---
        // (End logic remains the same - checks previously.couriers...items)
        const deliveryIdsToRemove = [];
        if (previousData && previousData.couriers) {
            for (const deliveryId in activeDeliveries) { /* ... existing end logic using previously ... */
                const delivery = activeDeliveries[deliveryId];
                const prevCourierData = previousData.couriers[delivery.courierId];
                if (prevCourierData && prevCourierData.items) {
                    let itemLeftCourier = false;
                    for (const itemToCheck of delivery.items) {
                        let foundInPrevious = false;
                        for (const prevItemSlot in prevCourierData.items) { if (prevCourierData.items[prevItemSlot].name === itemToCheck.name) { foundInPrevious = true; break; } }
                        if (foundInPrevious) {
                            let foundInCurrent = false;
                            const currentItemsOnThisCourier = currentCourierStateThisTick[delivery.courierId]?.itemNamesList || [];
                            if (currentItemsOnThisCourier.includes(itemToCheck.name)) { foundInCurrent = true; }
                            if (!foundInCurrent) { itemLeftCourier = true; console.log(`[${now.toLocaleTimeString()}] Detected item ${itemToCheck.name} left courier ${delivery.courierId}. Ending delivery ${deliveryId}.`); break; }
                        }
                    }
                    if (itemLeftCourier) { deliveryIdsToRemove.push(deliveryId); }
                }
            }
        }
        deliveryIdsToRemove.forEach(id => { if (activeDeliveries[id]) { console.log(`[${now.toLocaleTimeString()}] Removing completed delivery: ${id}`); delete activeDeliveries[id]; } });

        // Update previous state
        previousCourierState = currentCourierStateThisTick;

    } else if (currentGsiPayload?.map) {
        // Reset state if game not in progress
        const currentGameState = currentGsiPayload.map.game_state;
        if (!gameInProgress && (Object.keys(activeDeliveries).length > 0 || Object.keys(previousCourierState).length > 0)) { // Check previous state too
            console.log(` --> Game state is ${currentGameState}. Resetting active deliveries and courier state.`);
            activeDeliveries = {};
            previousCourierState = {}; // Reset previous state
        }
    }

    res.status(200).send('OK');
});

// --- Endpoints --- (Unchanged)
app.get('/delivery_data', (req, res) => { res.json(Object.values(activeDeliveries)); });
app.get('/courier_items', (req, res) => { res.sendFile(path.join(__dirname, 'courier_items.html')); });

// --- Server Start & Health Check --- (Unchanged)
app.listen(port, () => { /* ... */ });
setInterval(() => { /* ... */ });