import { useEffect, useMemo, useState } from "react";
import { api, setAuth } from "../api";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  type OutboxOp,
} from "../offline/db";
import { syncNow, setupOnlineSync } from "../offline/sync";
import { TaskImport } from '../components/TaskImport'; // Ajusta la ruta
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type Status = "Pendiente" | "En Progreso" | "Completada";

type Task = {
  _id: string;                 // serverId o clienteId (offline)
  title: string;
  description?: string;
  status: Status;
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
  pending?: boolean;           // <- muestra “Falta sincronizar”
};

// id local (no 24 hex de Mongo)
const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);

// Normaliza lo que venga del backend
function normalizeTask(x: any): Task {
  return {
    _id: String(x?._id ?? x?.id),
    title: String(x?.title ?? "(sin título)"),
    description: x?.description ?? "",
    status:
      x?.status === "Completada" ||
      x?.status === "En Progreso" ||
      x?.status === "Pendiente"
        ? x.status
        : "Pendiente",
    clienteId: x?.clienteId,
    createdAt: x?.createdAt,
    deleted: !!x?.deleted,
    pending: !!x?.pending,
  };
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [online, setOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    setAuth(localStorage.getItem("token"));

    // Suscripción que dispara sync al volver online (definida en offline/sync)
    const unsubscribe = setupOnlineSync();

    // Handlers de estado (sin recargar)
    const on = async () => {
      setOnline(true);
      await syncNow();
      await loadFromServer();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    (async () => {
      // 1) Mostrar cache local primero
      const local = await getAllTasksLocal();
      if (local?.length) setTasks(local.map(normalizeTask));

      // 2) Intentar traer del server
      await loadFromServer();

      // 3) Intentar sincronizar pendientes
      await syncNow();

      // 4) Re-cargar del server por si hubo mapeos nuevos
      await loadFromServer();
    })();

    return () => {
      unsubscribe?.();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function loadFromServer() {
    try {
      const { data } = await api.get("/tasks"); // { items: [...] }
      const raw = Array.isArray(data?.items) ? data.items : [];
      const list = raw.map(normalizeTask);
      setTasks(list);
      await cacheTasks(list);
    } catch {
      // si falla, nos quedamos con lo local
    } finally {
      setLoading(false);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const d = description.trim();
    if (!t) return;

    // Crear local inmediatamente
    const clienteId = crypto.randomUUID();
    const localTask = normalizeTask({
      _id: clienteId,
      title: t,
      description: d,
      status: "Pendiente" as Status,
      pending: !navigator.onLine, // <- marca “Falta sincronizar” si no hay red
    });

    setTasks((prev) => [localTask, ...prev]);
    await putTaskLocal(localTask);
    setTitle("");
    setDescription("");

    if (!navigator.onLine) {
      const op: OutboxOp = {
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
      return;
    }

    // Online directo
    try {
      const { data } = await api.post("/tasks", { title: t, description: d });
      const created = normalizeTask(data?.task ?? data);
      setTasks((prev) => prev.map((x) => (x._id === clienteId ? created : x)));
      await putTaskLocal(created);
    } catch {
      // si falla, encola
      const op: OutboxOp = {
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
    }
  }

async function handleImportTasks(importedTasks: any[]) {
    const existingTasks = await getAllTasksLocal();
    let importedCount = 0;
    let ignoredCount = 0;
    const newTasksToAdd: Task[] = [];

    for (const task of importedTasks) {
      if (!task.title) continue;

      // 🚀 CAMBIO CLAVE: Quitamos la validación por ID.
      // Ahora SOLO validamos por contenido. Si la tarea viene de otra persona, 
      // su ID no nos sirve, la tratamos como una tarea 100% nueva.
      const contentExists = existingTasks.some(
        et => et.title.trim().toLowerCase() === task.title.trim().toLowerCase() &&
              (et.description || '').trim().toLowerCase() === (task.description || '').trim().toLowerCase()
      );

      if (contentExists) {
        ignoredCount++;
        continue;
      }

      // 2. Crear la nueva tarea local con un ID nuevo (UUID) para evitar choques en MongoDB
      const clienteId = crypto.randomUUID(); 
      const localTask = normalizeTask({
        _id: clienteId,
        title: task.title,
        description: task.description || '',
        status: task.status || 'Pendiente',
        pending: !navigator.onLine, // Si no hay internet, se marca como pendiente
      });

      newTasksToAdd.push(localTask);
      importedCount++;
    }

    if (newTasksToAdd.length === 0) {
      alert(`No se añadieron tareas.\n⚠️ Ignoradas (duplicadas por título/descripción): ${ignoredCount}`);
      return;
    }

    // 3. Actualizamos el estado de React INMEDIATAMENTE
    setTasks(prev => [...newTasksToAdd, ...prev]);

    // 4. Las guardamos en IndexedDB y las encolamos para el backend
    for (const t of newTasksToAdd) {
      await putTaskLocal(t);
      const op: OutboxOp = {
        id: "op-" + t._id,
        op: "create",
        clienteId: t._id,
        data: t,
        ts: Date.now(),
      };
      await queue(op);
    }

    alert(`Importación completada.\n✅ Añadidas: ${importedCount}\n⚠️ Ignoradas (duplicadas): ${ignoredCount}`);

    // 5. Si hay internet, forzamos la sincronización
    if (navigator.onLine) {
      await syncNow();
      await loadFromServer();
    }
  }

  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDescription(task.description ?? "");
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    const newDesc  = editingDescription.trim();
    if (!newTitle) return;

    const before = tasks.find((t) => t._id === taskId);
    const patched = { ...before, title: newTitle, description: newDesc } as Task;

    setTasks((prev) => prev.map((t) => (t._id === taskId ? patched : t)));
    await putTaskLocal(patched);
    setEditingId(null);

    if (!navigator.onLine) {
      await queue({
        id: "upd-" + taskId,
        op: "update",
        clienteId: isLocalId(taskId) ? taskId : undefined,
        serverId: isLocalId(taskId) ? undefined : taskId,
        data: { title: newTitle, description: newDesc },
        ts: Date.now(),
      } as OutboxOp);
      return;
    }

    try {
      await api.put(`/tasks/${taskId}`, { title: newTitle, description: newDesc });
    } catch {
      await queue({
        id: "upd-" + taskId,
        op: "update",
        serverId: taskId,
        data: { title: newTitle, description: newDesc },
        ts: Date.now(),
      } as OutboxOp);
    }
  }

  async function handleStatusChange(task: Task, newStatus: Status) {
    const updated = { ...task, status: newStatus };
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    await putTaskLocal(updated);

    if (!navigator.onLine) {
      await queue({
        id: "upd-" + task._id,
        op: "update",
        serverId: isLocalId(task._id) ? undefined : task._id,
        clienteId: isLocalId(task._id) ? task._id : undefined,
        data: { status: newStatus },
        ts: Date.now(),
      });
      return;
    }

    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus });
    } catch {
      await queue({
        id: "upd-" + task._id,
        op: "update",
        serverId: task._id,
        data: { status: newStatus },
        ts: Date.now(),
      });
    }
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((prev) => prev.filter((t) => t._id !== taskId));
    await removeTaskLocal(taskId);

    if (!navigator.onLine) {
      await queue({ id: "del-" + taskId, op: "delete", serverId: isLocalId(taskId) ? undefined : taskId, clienteId: isLocalId(taskId) ? taskId : undefined, ts: Date.now() });
      return;
    }

    try {
      await api.delete(`/tasks/${taskId}`);
    } catch {
      // rollback + encola
      setTasks(backup);
      for (const t of backup) await putTaskLocal(t);
      await queue({ id: "del-" + taskId, op: "delete", serverId: taskId, clienteId: isLocalId(taskId) ? taskId : undefined, ts: Date.now() });
    }
  }

  function logout() {
    localStorage.removeItem("token");
    setAuth(null);
    window.location.href = "/"; // login
  }

  const filtered = useMemo(() => {
    let list = tasks;
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.title || "").toLowerCase().includes(s) ||
          (t.description || "").toLowerCase().includes(s)
      );
    }
    if (filter === "active") list = list.filter((t) => t.status !== "Completada");
    if (filter === "completed") list = list.filter((t) => t.status === "Completada");
    return list;
  }, [tasks, search, filter]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "Completada").length;
    return { total, done, pending: total - done };
  }, [tasks]);

function exportAllToPDF() {
    // Creamos un nuevo documento PDF
    const doc = new jsPDF();

    // Título principal en el PDF (X: 14, Y: 15)
    doc.text("Lista de Tareas - To-Do PWA", 14, 15);

    // Preparamos las filas de la tabla mapeando nuestro arreglo "filtered"
    const tableData = filtered.map((t) => [
      t.title,
      t.description || "---",
      t.status
    ]);

    // Dibujamos la tabla en el documento
    autoTable(doc, {
      startY: 20, // Empezamos un poco abajo del título
      head: [['Título', 'Descripción', 'Estado']],
      body: tableData,
      theme: 'grid', // Le da bordes a la tabla para que se vea formal
      headStyles: { fillColor: [31, 111, 235] } // Color azul que combina con tu app
    });

    // Forzamos la descarga
    doc.save("mis_tareas.pdf");
  }

function exportSingleTask(task: Task) {
// 1. Ahora INCLUIMOS el _id en el archivo a exportar
    const exportable = [{
      _id: task._id,
      title: task.title,
      description: task.description || "",
      status: task.status
    }];

    // 2. Lo convertimos a texto JSON
    const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // 3. Forzamos la descarga con un nombre bonito basado en el título
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = task.title.replace(/\s+/g, '-').toLowerCase(); 
    a.download = `tarea-${safeTitle}.json`;
    a.click();
    
    // Limpiamos memoria
    URL.revokeObjectURL(url);
  }

  return (
    <div className="wrap">
      <header className="topbar">
        <h1>To-Do PWA</h1>
        <div className="spacer" />
        <div className="stats">
          <span>Total: {stats.total}</span>
          <span>Hechas: {stats.done}</span>
          <span>Pendientes: {stats.pending}</span>
          <span className="badge" style={{ marginLeft: 8, background: online ? "#1f6feb" : "#b45309" }}>
            {online ? "Online" : "Offline"}
          </span>
        </div>
        <button className="btn danger" onClick={logout}>Salir</button>
      </header>

      <main>
        {/* ===== Crear ===== */}
        <form className="add add-grid" onSubmit={addTask}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título de la tarea…"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción (opcional)…"
            rows={2}
          />
          <button className="btn">Agregar</button>
        </form>

        {/* ===== Toolbar ===== */}
          <div className="toolbar">
          <TaskImport 
            onImport={handleImportTasks} 
          />
          <button 
              className="btn" 
              onClick={exportAllToPDF}
              type="button"
              style={{ background: '#dc2626', color: 'white', padding: '0.5rem 1rem' }}
              title="Descargar lista actual en PDF"
            >
              📄 PDF
            </button>
          <input
            className="search"
            placeholder="Buscar por título o descripción…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="filters">
            <button
              className={filter === "all" ? "chip active" : "chip"}
              onClick={() => setFilter("all")}
              type="button"
            >
              Todas
            </button>
            <button
              className={filter === "active" ? "chip active" : "chip"}
              onClick={() => setFilter("active")}
              type="button"
            >
              Activas
            </button>
            <button
              className={filter === "completed" ? "chip active" : "chip"}
              onClick={() => setFilter("completed")}
              type="button"
            >
              Hechas
            </button>
          </div>
        </div>

        {/* ===== Lista ===== */}
        {loading ? (
          <p>Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className="empty">Sin tareas</p>
        ) : (
          <ul className="list">
            {filtered.map((t) => (
              <li key={t._id} className={t.status === "Completada" ? "item done" : "item"}>
                {/* Select de estado */}
                <select
                  value={t.status}
                  onChange={(e) => handleStatusChange(t, e.target.value as Status)}
                  className="status-select"
                  title="Estado"
                >
                  <option value="Pendiente">Pendiente</option>
                  <option value="En Progreso">En Progreso</option>
                  <option value="Completada">Completada</option>
                </select>

                <div className="content">
                  {editingId === t._id ? (
                    <>
                      <input
                        className="edit"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        placeholder="Título"
                        autoFocus
                      />
                      <textarea
                        className="edit"
                        value={editingDescription}
                        onChange={(e) => setEditingDescription(e.target.value)}
                        placeholder="Descripción"
                        rows={2}
                      />
                    </>
                  ) : (
                    <>
                      <span className="title" onDoubleClick={() => startEdit(t)}>
                        {t.title}
                      </span>
                      {t.description && <p className="desc">{t.description}</p>}
                      {(t.pending || isLocalId(t._id)) && (
                        <span
                          className="badge"
                          title="Aún no sincronizada"
                          style={{ background: "#b45309", width: "fit-content" }}
                        >
                          Falta sincronizar
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div className="actions">
                  <button 
                    className="icon" 
                    title="Exportar tarea (JSON)" 
                    onClick={() => exportSingleTask(t)}
                  >
                    📤
                  </button>

                  {editingId === t._id ? (
                    <button className="btn" onClick={() => saveEdit(t._id)}>Guardar</button>
                  ) : (
                    <button className="icon" title="Editar" onClick={() => startEdit(t)}>✏️</button>
                  )}
                  <button className="icon danger" title="Eliminar" onClick={() => removeTask(t._id)}>
                    🗑️
                  </button>
                  
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}