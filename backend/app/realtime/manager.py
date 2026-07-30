from collections import defaultdict
from uuid import UUID

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[UUID, set[WebSocket]] = defaultdict(set)

    async def connect(self, account_id: UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections[account_id].add(websocket)

    def disconnect(self, account_id: UUID, websocket: WebSocket) -> None:
        self.connections[account_id].discard(websocket)
        if not self.connections[account_id]:
            self.connections.pop(account_id, None)

    async def broadcast(self, account_id: UUID, event: dict) -> None:
        stale = []
        for websocket in self.connections.get(account_id, set()):
            try:
                await websocket.send_json(event)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            self.disconnect(account_id, websocket)


manager = ConnectionManager()
