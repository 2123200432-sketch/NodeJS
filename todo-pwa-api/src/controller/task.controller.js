// controllers/task.controller.js
import Task from "../models/task.js";

const allowed = ["Pendiente", "En Progreso", "Completada"]; // <-- usa este nombre en todos lados

export async function list(req, res) {
  const items = await Task.find({ user: req.userId, deleted: false }).sort({ createdAt: -1 });
  res.json({ items });
}

export async function create(req, res) {
  const { title, description = "", status = "Pendiente", clienteId } = req.body;
  if (!title) return res.status(400).json({ message: "El título es requerido" });

  const task = await Task.create({
    user: req.userId,
    title,
    description,
    status: allowed.includes(status) ? status : "Pendiente", // <-- allowed
    clienteId,
  });
  res.status(201).json({ task });
}

export async function update(req, res) {
  const { id } = req.params;
  const { title, description, status } = req.body;

  if (status && !allowed.includes(status))
    return res.status(400).json({ message: "Estado inválido" });

  const task = await Task.findOneAndUpdate(
    { _id: id, user: req.userId },
    { title, description, status },
    { new: true }
  );
  if (!task) return res.status(404).json({ message: "Tarea no encontrada" });
  res.json({ task });
}

export async function remove(req, res) {
  const { id } = req.params;
  const task = await Task.findOneAndUpdate(
    { _id: id, user: req.userId },
    { deleted: true },
    { new: true }
  );
  if (!task) return res.status(404).json({ message: "Tarea no encontrada" });
  res.json({ ok: true });
}

/** ENDPOINT PARA SINCRONIZACIÓN OFFLINE: crea/actualiza por clienteId y devuelve el mapeo */
export async function bulksync(req, res) {
  try {
    const { tasks = [] } = req.body;
    if (!Array.isArray(tasks)) return res.status(400).json({ message: "tasks debe ser array" });

    const mapping = [];

    for (const t of tasks) {
      if (!t || !t.clienteId || !t.title) continue;

      let doc = await Task.findOne({ user: req.userId, clienteId: t.clienteId });

      if (!doc) {
        doc = await Task.create({
          user: req.userId,
          title: t.title,
          description: t.description ?? "",
          status: allowed.includes(t.status) ? t.status : "Pendiente",
          clienteId: t.clienteId,
        });
      } else {
        doc.title = t.title ?? doc.title;
        doc.description = t.description ?? doc.description;
        if (t.status && allowed.includes(t.status)) doc.status = t.status;
        await doc.save();
      }

      mapping.push({ clienteId: t.clienteId, serverId: String(doc._id) });
    }

    return res.json({ mapping });
  } catch (err) {
    console.error("bulksync error:", err);
    return res.status(500).json({ message: "Error en bulksync" });
  }
}