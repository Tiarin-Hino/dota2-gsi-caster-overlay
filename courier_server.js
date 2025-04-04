// console.log(JSON.stringify(req.body, null, 2)); // Log the entire payload
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const port = 3003; // Must match gsi_courier_overlay.cfg

// --- State Variables ---
// Stores previous state of items on each courier
// Format: { courierId: { owner: playerSlot, items: {itemName: count}, itemNamesList: ['name1',...] }, ... }
let previousCourierState = {};
// Stores active deliveries tracked by this server
// Format: { deliveryId: { deliveryId: ..., courierId: ..., ownerPlayerKey: ..., items: [{name: 'item_name'}], startTime: ..., heroName: ... }, ... }
let activeDeliveries = {};
let lastReceivedTimestamp = null;
// --- End State Variables ---

app.use(express.static(__dirname));
app.use(bodyParser.json({ limit: '5mb' })); // Keep larger limit just in case

// --- Helper: Convert player slot (0-9) to playerKey ('player0'-'player9') ---
function slotToPlayerKey(slot) {
    if (slot >= 0 && slot <= 9) {
        return `player${slot}`;
    }
    return null; // Invalid slot
}
// --- End Helper ---

app.post('/', (req, res) => {
    console.log(JSON.stringify(req.body, null, 2)); // Log the entire payload
    const now = new Date();
    lastReceivedTimestamp = now;
    const currentGsiPayload = req.body;
    let gameInProgress = false;
    const deliveryIdCounter = now.getTime(); // Use timestamp for unique part of ID

    // Determine game state
    if (currentGsiPayload?.map?.game_state === 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS') {
        gameInProgress = true;
    }

    // Process only if in game and necessary data exists
    if (gameInProgress && currentGsiPayload.couriers && currentGsiPayload.hero && currentGsiPayload.player) {
        const currentCouriers = currentGsiPayload.couriers;
        const previousData = currentGsiPayload.previously;
        let currentCourierStateThisTick = {}; // Store current state for next comparison

        // --- Step 1: Process Current Courier States and Detect New Items ---
        for (const courierId in currentCouriers) { // e.g., courierId = "courier8"
            if (currentCouriers.hasOwnProperty(courierId)) {
                const courier = currentCouriers[courierId];
                const courierItems = courier.items || {}; // Get items object for this courier
                const ownerSlot = courier.owner; // Player slot number (e.g., 6)
                const ownerPlayerKey = slotToPlayerKey(ownerSlot);

                let currentItemsList = [];
                let currentItemsCount = {};
                for (const itemSlot in courierItems) { // e.g., itemSlot = "item0"
                    if (courierItems.hasOwnProperty(itemSlot) && courierItems[itemSlot].name !== 'empty') {
                        const itemName = courierItems[itemSlot].name;
                        currentItemsList.push({ name: itemName }); // Keep simple list for active delivery
                        currentItemsCount[itemName] = (currentItemsCount[itemName] || 0) + 1;
                    }
                }

                // Store current state for next tick comparison
                currentCourierStateThisTick[courierId] = {
                    owner: ownerSlot,
                    items: currentItemsCount, // Store item counts for comparison
                    itemNamesList: Object.keys(currentItemsCount) // Store just names for easier diff check
                };

                // Compare with previous state to detect NEWLY added items
                const prevCourier = previousCourierState[courierId];
                const prevItemNames = new Set(prevCourier?.itemNamesList || []);
                const newItemNames = currentCourierStateThisTick[courierId].itemNamesList.filter(name => !prevItemNames.has(name));

                // If new items appeared ON THIS COURIER and no active delivery exists for THIS COURIER
                if (newItemNames.length > 0 && !Object.values(activeDeliveries).some(d => d.courierId === courierId)) {
                    const deliveryId = `${courierId}-${deliveryIdCounter}`;

                    let heroName = 'unknown_hero';
                    // Lookup hero name using ownerPlayerKey
                    let teamKeyForHero = null;
                    if (currentGsiPayload.hero.team2 && currentGsiPayload.hero.team2[ownerPlayerKey]) teamKeyForHero = 'team2';
                    else if (currentGsiPayload.hero.team3 && currentGsiPayload.hero.team3[ownerPlayerKey]) teamKeyForHero = 'team3';
                    if (teamKeyForHero && currentGsiPayload.hero[teamKeyForHero][ownerPlayerKey]) heroName = currentGsiPayload.hero[teamKeyForHero][ownerPlayerKey].name;

                    // Create the delivery object - use the FULL current item list on courier
                    activeDeliveries[deliveryId] = {
                        deliveryId: deliveryId,
                        courierId: courierId,
                        ownerPlayerKey: ownerPlayerKey, // Player who owns courier (might not be recipient!)
                        items: currentItemsList,        // List of ALL items currently on courier
                        startTime: now.getTime(),
                        heroName: heroName              // Hero name of courier owner
                    };
                    console.log(`[${now.toLocaleTimeString()}] Started tracking delivery ${deliveryId} (Courier: ${courierId}, Owner: ${ownerPlayerKey}/${heroName}) Items:`, currentItemsList.map(i => i.name).join(', '));
                }
            }
        }

        // --- Step 2: Check if any active deliveries have ended using 'previously' ---
        const deliveryIdsToRemove = [];
        if (previousData && previousData.couriers) { // Check if 'previously.couriers' exists
            for (const deliveryId in activeDeliveries) {
                const delivery = activeDeliveries[deliveryId];
                const prevCourierData = previousData.couriers[delivery.courierId];

                // Check if the courier appeared in 'previously' AND had items listed
                if (prevCourierData && prevCourierData.items) {
                    // Check if ANY of the items originally tracked for this delivery were present in the previous tick's courier data
                    let itemLeftCourier = false;
                    for (const itemToCheck of delivery.items) { // Iterate through items tracked for this specific delivery
                        let foundInPrevious = false;
                        for (const prevItemSlot in prevCourierData.items) {
                            if (prevCourierData.items[prevItemSlot].name === itemToCheck.name) {
                                foundInPrevious = true;
                                break;
                            }
                        }
                        if (foundInPrevious) {
                            // Check if this item is GONE from the CURRENT courier state
                            let foundInCurrent = false;
                            const currentItemsOnThisCourier = currentCourierStateThisTick[delivery.courierId]?.itemNamesList || [];
                            if (currentItemsOnThisCourier.includes(itemToCheck.name)) {
                                foundInCurrent = true;
                            }

                            if (!foundInCurrent) { // Item was on courier previously, but not now
                                itemLeftCourier = true;
                                console.log(`[${now.toLocaleTimeString()}] Detected item ${itemToCheck.name} left courier ${delivery.courierId}. Ending delivery ${deliveryId}.`);
                                break; // Assume delivery ended if one tracked item leaves
                            }
                        }
                    }
                    if (itemLeftCourier) {
                        deliveryIdsToRemove.push(deliveryId);
                    }

                } else if (prevCourierData && !prevCourierData.items) {
                    // If courier was in previously block but had no items listed (maybe structure change?)
                    // This might indicate items left if delivery.items had items. Less reliable.
                    if (delivery.items.length > 0) {
                        // console.log(`[${now.toLocaleTimeString()}] Courier ${delivery.courierId} in 'previously' without items. Ending delivery ${deliveryId} as precaution.`);
                        // deliveryIdsToRemove.push(deliveryId); // Optionally end here too? Might be too aggressive.
                    }
                }
            }
        }

        // Remove completed deliveries
        deliveryIdsToRemove.forEach(id => {
            if (activeDeliveries[id]) { // Ensure it still exists
                console.log(`[${now.toLocaleTimeString()}] Removing completed delivery: ${id}`);
                delete activeDeliveries[id];
            }
        });

        // Update previous state for the next tick
        previousCourierState = currentCourierStateThisTick;


    } else if (currentGsiPayload?.map) {
        // Reset state if game not in progress
        const currentGameState = currentGsiPayload.map.game_state;
        if (!gameInProgress && (Object.keys(activeDeliveries).length > 0 || Object.keys(previousCourierState).length > 0)) {
            console.log(` --> Game state is ${currentGameState}. Resetting active deliveries and courier state.`);
            activeDeliveries = {};
            previousCourierState = {};
        }
    }

    res.status(200).send('OK');
});

// --- Endpoints ---
// Serve the active deliveries list
app.get('/delivery_data', (req, res) => {
    res.json(Object.values(activeDeliveries));
});

// Serve the HTML file
app.get('/courier_items', (req, res) => {
    res.sendFile(path.join(__dirname, 'courier_items.html'));
});

// --- Server Start & Health Check ---
app.listen(port, () => {
    console.log(`------------------------------------------------------`);
    console.log(`Dota 2 Courier GSI Listener running at http://localhost:${port}`);
    console.log(`Courier Items Overlay available at http://localhost:${port}/courier_items`);
    console.log(`(Data endpoint: http://localhost:${port}/delivery_data)`);
    console.log(`------------------------------------------------------`);
    console.log('Waiting for Dota 2 GSI data on port ' + port + '...');
    console.log('Ensure GSI config points here + includes couriers, previously, hero, player');
});

setInterval(() => {
    if (lastReceivedTimestamp && (new Date() - lastReceivedTimestamp > 60000)) {
        console.warn(`(!) Courier Server Warning: Haven't received GSI data in the last minute on port ${port}.`);
        lastReceivedTimestamp = null;
    }
}, 30000);