# Dota 2 GSI Caster Overlay

Real-time broadcast overlays for Dota 2 matches using Game State Integration (GSI).

## Features

- **Damage Dealt** - Bar chart showing hero damage output for all players
- **Damage Received** - Bar chart showing damage taken by each hero
- **Wards** - Dual bar chart for wards placed and destroyed
- **Courier Items** - Real-time tracking of courier deliveries

## Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher)
- Dota 2
- OBS Studio (or any streaming software with Browser Source support)

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/dota2-gsi-caster-overlay.git
   cd dota2-gsi-caster-overlay
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Copy GSI configuration file**

   Copy the `.cfg` file to your Dota 2 GSI folder:
   ```
   Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\
   ```

   File to copy:
   - `gamestate_integration_caster_overlay.cfg`

4. **Start the server**
   ```bash
   npm start
   ```

## Usage

### OBS Browser Source Setup

Add Browser Sources in OBS pointing to these URLs:

| Overlay | URL | Recommended Size |
|---------|-----|------------------|
| Damage Dealt | `http://localhost:3002/damage_dealt` | 1920x300 |
| Damage Received | `http://localhost:3002/damage_received` | 1920x300 |
| Wards | `http://localhost:3002/wards` | 1920x300 |
| Courier Items | `http://localhost:3002/courier_items` | 400x600 |

### How It Works

1. Start the overlay server
2. Launch Dota 2 and start/spectate a match
3. The overlays will automatically receive game data via GSI
4. Data updates in real-time during the match

## Project Structure

```
dota2-gsi-caster-overlay/
├── server.js                                    # Main server (all overlays)
├── package.json                                 # Dependencies
├── damage_dealt.html                            # Damage dealt overlay
├── damage_received.html                         # Damage received overlay
├── wards.html                                   # Wards overlay
├── courier_items.html                           # Courier items overlay
├── gamestate_integration_caster_overlay.cfg     # GSI config
└── *.png                                        # Icon assets
```

## Troubleshooting

- **Overlays show no data**: Make sure the `.cfg` file is in the correct Dota 2 folder and restart Dota 2
- **Connection issues**: Check that port 3002 is not in use by another application
- **GSI not working**: Verify you're in a match (GSI only sends data during active games)

## Tech Stack

- Node.js
- Express.js 5.1
- Vanilla JavaScript
- Dota 2 Game State Integration

## License

MIT License - See [LICENSE](LICENSE) for details.
