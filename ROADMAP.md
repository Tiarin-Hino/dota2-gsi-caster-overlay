# Roadmap

Technical improvements planned for the project.

## Server Consolidation

- [x] Merge `server.js` and `courier_server.js` into a single server
- [x] Use a single port for all overlays
- [x] Simplify startup to one command

## Configuration

- [ ] Create `config.js` for centralized settings (ports, URLs, colors)
- [ ] Add optional `.env` file support for easy customization

## Code Quality

- [ ] Add better error handling with user-friendly messages
- [ ] Add logging for debugging GSI connection issues
- [ ] Add code comments for maintainability

## Performance

- [ ] Add WebSocket support for real-time updates (replace polling)
- [ ] Cache Steam CDN assets locally to reduce network requests

## Developer Experience

- [ ] Add `nodemon` for auto-restart during development
- [ ] Create npm scripts for dev/production modes
