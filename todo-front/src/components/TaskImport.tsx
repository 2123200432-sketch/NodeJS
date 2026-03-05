import React, { useRef } from 'react';

// Fíjate que ahora recibe "onImport" para conectarse con tu Dashboard
interface Props {
  onImport: (tasks: any[]) => void;
}

export function TaskImport({ onImport }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importedTasks = JSON.parse(text);

      if (!Array.isArray(importedTasks)) {
        alert('El archivo no tiene el formato correcto. Debe ser un arreglo de tareas.');
        return;
      }

      // 🚀 Aquí es la magia: Le pasamos las tareas directamente a tu Dashboard 
      // para que él use tu función handleImportTasks y actualice la pantalla.
      onImport(importedTasks);

    } catch (error) {
      console.error("Error al importar:", error);
      alert('Hubo un error al leer el archivo. Verifica que sea el JSON correcto.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
      <button 
        className="btn" 
        onClick={() => fileInputRef.current?.click()} 
        type="button"
        style={{ background: '#475569', color: 'white' }}
      >
        📥 Importar Tarea desde JSON
      </button>
      
      <input
        type="file"
        accept=".json"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleImport}
      />
    </div>
  );
}