import { Response } from "express";

const clients = new Set<Response>();

export function addSSEClient(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    try { res.write("event: heartbeat\ndata: {}\n\n"); } catch { /* ignore */ }
  }, 25000);

  clients.add(res);

  res.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

export function broadcast(event: string, data: object) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.write(payload); } catch { clients.delete(client); }
  }
}

export function broadcastSyncStatus(
  job: string,
  status: "running" | "success" | "error",
  detail?: string,
) {
  broadcast("sync_status", { job, status, detail, timestamp: new Date().toISOString() });
}

export function broadcastNewGoblin(playerName: string, stat: string, line: number, sport: string) {
  broadcast("new_goblin", { playerName, stat, line, sport, timestamp: new Date().toISOString() });
}

export function broadcastLineMove(playerName: string, stat: string, from: number, to: number) {
  broadcast("line_move", { playerName, stat, from, to, diff: to - from, timestamp: new Date().toISOString() });
}
