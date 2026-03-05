/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from "../api";
import {
  getOutbox, clearOutbox, setMapping, getMapping,
  removeTaskLocal, promoteLocalToServer
} from "./db";

// 👇 Banderita (candado) para evitar que la sincronización se ejecute dos veces al mismo tiempo
let isSyncing = false;

export async function syncNow() {
  // Si no hay internet o YA está sincronizando, nos salimos inmediatamente
  if (!navigator.onLine || isSyncing) return;

  isSyncing = true; // 🔒 Ponemos el candado

  try {
    const ops = (await getOutbox() as any[]).sort((a, b) => a.ts - b.ts);
    
    if (!ops.length) return; // Si no hay nada que sincronizar, nos salimos

    // 1. Preparamos las tareas para bulksync (crear/actualizar)
    const toSync: any[] = [];
    for (const op of ops) {
      if (op.op === "create") {
        toSync.push({
          clienteId: op.clienteId,
          title: op.data.title,
          description: op.data.description ?? "",
          status: op.data.status ?? "Pendiente",
        });
      } else if (op.op === "update") {
        const cid = op.clienteId;
        if (cid) {
          toSync.push({
            clienteId: cid,
            title: op.data.title,
            description: op.data.description,
            status: op.data.status,
          });
        } else if (op.serverId) {
          try { await api.put(`/tasks/${op.serverId}`, op.data); } catch {}
        }
      }
    }

    // 2. Ejecutamos bulksync y actualizamos los IDs locales a los del servidor
    if (toSync.length) {
      try {
        const { data } = await api.post("/tasks/bulksync", { tasks: toSync });
        for (const map of data?.mapping || []) {
          await setMapping(map.clienteId, map.serverId);
          await promoteLocalToServer(map.clienteId, map.serverId); // Quita pending y cambia _id
        }
      } catch (err) {
        console.error("Falló el bulksync, abortando limpieza:", err);
        return; // 🛑 Salimos para NO borrar el outbox si el servidor falló
      }
    }

    // 3. Borramos las tareas que se eliminaron en modo offline
    for (const op of ops) {
      if (op.op !== "delete") continue;
      const serverId = op.serverId ?? (op.clienteId ? await getMapping(op.clienteId) : undefined);
      if (!serverId) continue;
      try { 
        await api.delete(`/tasks/${serverId}`); 
        await removeTaskLocal(op.clienteId || serverId); 
      } catch {}
    }

    // 4. Si llegamos hasta aquí, todo fue un éxito. Limpiamos la cola de offline.
    await clearOutbox();

  } finally {
    isSyncing = false; // 🔓 Pase lo que pase (éxito o error), quitamos el candado al final para futuras sincronizaciones
  }
}

// Suscripción a online/offline
export function setupOnlineSync() {
  const handler = () => { void syncNow(); };
  window.addEventListener("online", handler);
  return () => window.removeEventListener("online", handler);
}