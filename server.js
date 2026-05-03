const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize tables
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL UNIQUE,
        descripcion TEXT DEFAULT '',
        orden INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        precio_venta REAL DEFAULT 0,
        precio_costo REAL DEFAULT 0,
        cantidad INTEGER DEFAULT 0,
        categoria TEXT DEFAULT '',
        categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
        talla TEXT DEFAULT '',
        color TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Migrations: add columns that may be missing on older tables
    await client.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS talla TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS color TEXT DEFAULT ''`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS productos_imagenes (
        id SERIAL PRIMARY KEY,
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        orden INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS variantes (
        id SERIAL PRIMARY KEY,
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        nombre_variante TEXT NOT NULL,
        precio_extra REAL DEFAULT 0,
        stock_extra INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS movimientos (
        id SERIAL PRIMARY KEY,
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        tipo TEXT CHECK(tipo IN ('entrada', 'salida')) NOT NULL,
        cantidad INTEGER NOT NULL,
        fecha DATE DEFAULT CURRENT_DATE,
        notas TEXT DEFAULT '',
        cliente TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS proveedores (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        direccion TEXT DEFAULT '',
        telefono TEXT DEFAULT '',
        notas TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS proveedor_productos (
        id SERIAL PRIMARY KEY,
        proveedor_id INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        UNIQUE(proveedor_id, producto_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        telefono TEXT DEFAULT '',
        direccion TEXT DEFAULT '',
        notas TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Tablas verificadas correctamente.');
  } catch (err) {
    console.error('Error inicializando DB:', err);
  } finally {
    client.release();
  }
}

initDB();

// ==================== API RUTAS ====================

// GET /api/dashboard
app.get('/api/dashboard', async (req, res) => {
  try {
    const totalProductos = await pool.query('SELECT COUNT(*)::int as total FROM productos');
    const valorInventario = await pool.query('SELECT COALESCE(SUM(precio_costo * cantidad), 0)::float as total FROM productos');
    const bajosStock = await pool.query("SELECT COUNT(*)::int as total FROM productos WHERE cantidad <= 5 AND cantidad > 0");
    const sinStock = await pool.query("SELECT COUNT(*)::int as total FROM productos WHERE cantidad = 0");
    const ultimosMovimientos = await pool.query(`
      SELECT m.*, p.nombre as producto_nombre
      FROM movimientos m
      LEFT JOIN productos p ON m.producto_id = p.id
      ORDER BY m.created_at DESC LIMIT 10
    `);
    const productosBajos = await pool.query('SELECT * FROM productos WHERE cantidad <= 5 ORDER BY cantidad ASC LIMIT 10');

    res.json({
      totalProductos: totalProductos.rows[0].total,
      valorInventario: valorInventario.rows[0].total || 0,
      bajosStock: bajosStock.rows[0].total,
      sinStock: sinStock.rows[0].total,
      ultimosMovimientos: ultimosMovimientos.rows,
      productosBajos: productosBajos.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/productos
app.get('/api/productos', async (req, res) => {
  try {
    let query = 'SELECT * FROM productos WHERE 1=1';
    const params = [];
    if (req.query.search) {
      query += ' AND (nombre ILIKE $1 OR categoria ILIKE $1)';
      params.push(`%${req.query.search}%`);
    }
    if (req.query.categoria) {
      query += params.length ? ` AND categoria = $${params.length + 1}` : ' AND categoria = $1';
      params.push(req.query.categoria);
    }
    query += ' ORDER BY nombre ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/productos/:id
app.get('/api/productos/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM productos WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/productos
app.post('/api/productos', async (req, res) => {
  try {
    const { nombre, precio_venta, precio_costo, cantidad, categoria, categoria_id, talla, color } = req.body;
    const result = await pool.query(
      `INSERT INTO productos (nombre, precio_venta, precio_costo, cantidad, categoria, categoria_id, talla, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [nombre, precio_venta || 0, precio_costo || 0, cantidad || 0, categoria || '', categoria_id || null, talla || '', color || '']
    );
    res.status(201).json({ id: result.rows[0].id, message: 'Producto creado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/productos/:id
app.put('/api/productos/:id', async (req, res) => {
  try {
    const fields = [];
    const params = [];
    let idx = 1;
    ['nombre', 'precio_venta', 'precio_costo', 'cantidad', 'categoria', 'categoria_id', 'talla', 'color'].forEach(f => {
      if (req.body[f] !== undefined) {
        fields.push(`${f} = $${idx++}`);
        params.push(req.body[f]);
      }
    });
    if (fields.length === 0) return res.status(400).json({ error: 'Sin campos' });
    params.push(req.params.id);
    await pool.query(`UPDATE productos SET ${fields.join(', ')} WHERE id = $${idx}`, params);
    res.json({ message: 'Producto actualizado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/productos/:id
app.delete('/api/productos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM productos_imagenes WHERE producto_id = $1', [req.params.id]);
    await pool.query('DELETE FROM variantes WHERE producto_id = $1', [req.params.id]);
    await pool.query('DELETE FROM proveedor_productos WHERE producto_id = $1', [req.params.id]);
    await pool.query('DELETE FROM movimientos WHERE producto_id = $1', [req.params.id]);
    await pool.query('DELETE FROM productos WHERE id = $1', [req.params.id]);
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/productos/buscar/:query
app.get('/api/productos/buscar/:query', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM productos WHERE nombre ILIKE $1 OR categoria ILIKE $1 ORDER BY nombre ASC',
      [`%${req.params.query}%`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/productos/bajos-stock/:threshold?
app.get('/api/productos/bajos-stock/:threshold?', async (req, res) => {
  try {
    const threshold = parseInt(req.params.threshold) || 5;
    const result = await pool.query('SELECT * FROM productos WHERE cantidad <= $1 ORDER BY cantidad ASC', [threshold]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/movimientos
app.get('/api/movimientos', async (req, res) => {
  try {
    let query = `SELECT m.*, p.nombre as producto_nombre FROM movimientos m LEFT JOIN productos p ON m.producto_id = p.id WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (req.query.producto_id) { query += ` AND m.producto_id = $${idx++}`; params.push(req.query.producto_id); }
    if (req.query.tipo) { query += ` AND m.tipo = $${idx++}`; params.push(req.query.tipo); }
    if (req.query.desde) { query += ` AND m.fecha >= $${idx++}`; params.push(req.query.desde); }
    if (req.query.hasta) { query += ` AND m.fecha <= $${idx++}`; params.push(req.query.hasta); }
    query += ' ORDER BY m.created_at DESC LIMIT 200';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/movimientos
app.post('/api/movimientos', async (req, res) => {
  const client = await pool.connect();
  try {
    const { producto_id, tipo, cantidad, fecha, notas, cliente } = req.body;
    await client.query('BEGIN');

    const prod = await client.query('SELECT * FROM productos WHERE id = $1 FOR UPDATE', [producto_id]);
    if (prod.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    if (tipo === 'salida' && prod.rows[0].cantidad < cantidad) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente' });
    }

    await client.query(
      tipo === 'entrada'
        ? 'UPDATE productos SET cantidad = cantidad + $1 WHERE id = $2'
        : 'UPDATE productos SET cantidad = cantidad - $1 WHERE id = $2',
      [cantidad, producto_id]
    );

    await client.query(
      `INSERT INTO movimientos (producto_id, tipo, cantidad, fecha, notas, cliente) VALUES ($1,$2,$3,$4,$5,$6)`,
      [producto_id, tipo, cantidad, fecha || new Date().toISOString().split('T')[0], notas || '', cliente || '']
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Movimiento registrado' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==================== CATEGORIAS (dinámicas) ====================
app.get('/api/categorias', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categorias ORDER BY orden ASC, nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/categorias/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categorias WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categorias', async (req, res) => {
  try {
    const { nombre, descripcion, orden } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const result = await pool.query(
      'INSERT INTO categorias (nombre, descripcion, orden) VALUES ($1, $2, $3) RETURNING *',
      [nombre, descripcion || '', orden || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categorias/:id', async (req, res) => {
  try {
    const fields = [];
    const params = [];
    let idx = 1;
    ['nombre', 'descripcion', 'orden'].forEach(f => {
      if (req.body[f] !== undefined) {
        fields.push(`${f} = $${idx++}`);
        params.push(req.body[f]);
      }
    });
    if (fields.length === 0) return res.status(400).json({ error: 'Sin campos' });
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE categorias SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categorias/:id', async (req, res) => {
  try {
    await pool.query('UPDATE productos SET categoria_id = NULL WHERE categoria_id = $1', [req.params.id]);
    await pool.query('DELETE FROM categorias WHERE id = $1', [req.params.id]);
    res.json({ message: 'Categoría eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== IMÁGENES DE PRODUCTOS ====================
app.get('/api/productos/:id/imagenes', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM productos_imagenes WHERE producto_id = $1 ORDER BY orden ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/productos/:id/imagenes', async (req, res) => {
  try {
    const { url, orden } = req.body;
    if (!url) return res.status(400).json({ error: 'URL de imagen requerida (base64 data URL)' });
    const result = await pool.query(
      'INSERT INTO productos_imagenes (producto_id, url, orden) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, url, orden || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/imagenes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM productos_imagenes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Imagen eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== VARIANTES ====================
app.get('/api/productos/:id/variantes', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM variantes WHERE producto_id = $1 ORDER BY nombre_variante ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/productos/:id/variantes', async (req, res) => {
  try {
    const { nombre_variante, precio_extra, stock_extra } = req.body;
    if (!nombre_variante) return res.status(400).json({ error: 'Nombre de variante requerido' });
    const result = await pool.query(
      'INSERT INTO variantes (producto_id, nombre_variante, precio_extra, stock_extra) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, nombre_variante, precio_extra || 0, stock_extra || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/variantes/:id', async (req, res) => {
  try {
    const fields = [];
    const params = [];
    let idx = 1;
    ['nombre_variante', 'precio_extra', 'stock_extra'].forEach(f => {
      if (req.body[f] !== undefined) {
        fields.push(`${f} = $${idx++}`);
        params.push(req.body[f]);
      }
    });
    if (fields.length === 0) return res.status(400).json({ error: 'Sin campos' });
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE variantes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Variante no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/variantes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM variantes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Variante eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PROVEEDORES ====================
app.get('/api/proveedores', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM proveedores ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/proveedores/:id', async (req, res) => {
  try {
    const prov = await pool.query('SELECT * FROM proveedores WHERE id = $1', [req.params.id]);
    if (prov.rows.length === 0) return res.status(404).json({ error: 'Proveedor no encontrado' });
    const productos = await pool.query(
      `SELECT p.* FROM productos p
       INNER JOIN proveedor_productos pp ON p.id = pp.producto_id
       WHERE pp.proveedor_id = $1 ORDER BY p.nombre ASC`,
      [req.params.id]
    );
    res.json({ ...prov.rows[0], productos: productos.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/proveedores', async (req, res) => {
  try {
    const { nombre, direccion, telefono, notas } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const result = await pool.query(
      'INSERT INTO proveedores (nombre, direccion, telefono, notas) VALUES ($1, $2, $3, $4) RETURNING *',
      [nombre, direccion || '', telefono || '', notas || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/proveedores/:id', async (req, res) => {
  try {
    const fields = [];
    const params = [];
    let idx = 1;
    ['nombre', 'direccion', 'telefono', 'notas'].forEach(f => {
      if (req.body[f] !== undefined) {
        fields.push(`${f} = $${idx++}`);
        params.push(req.body[f]);
      }
    });
    if (fields.length === 0) return res.status(400).json({ error: 'Sin campos' });
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE proveedores SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/proveedores/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM proveedor_productos WHERE proveedor_id = $1', [req.params.id]);
    await pool.query('DELETE FROM proveedores WHERE id = $1', [req.params.id]);
    res.json({ message: 'Proveedor eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proveedor-productos linking
app.post('/api/proveedores/:id/productos', async (req, res) => {
  try {
    const { producto_id } = req.body;
    if (!producto_id) return res.status(400).json({ error: 'producto_id requerido' });
    await pool.query(
      'INSERT INTO proveedor_productos (proveedor_id, producto_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, producto_id]
    );
    res.status(201).json({ message: 'Producto vinculado al proveedor' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/proveedores/:id/productos/:producto_id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM proveedor_productos WHERE proveedor_id = $1 AND producto_id = $2',
      [req.params.id, req.params.producto_id]
    );
    res.json({ message: 'Producto desvinculado del proveedor' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CLIENTES ====================
app.get('/api/clientes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clientes ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clientes/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clientes', async (req, res) => {
  try {
    const { nombre, telefono, direccion, notas } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const result = await pool.query(
      'INSERT INTO clientes (nombre, telefono, direccion, notas) VALUES ($1, $2, $3, $4) RETURNING *',
      [nombre, telefono || '', direccion || '', notas || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clientes/:id', async (req, res) => {
  try {
    const fields = [];
    const params = [];
    let idx = 1;
    ['nombre', 'telefono', 'direccion', 'notas'].forEach(f => {
      if (req.body[f] !== undefined) {
        fields.push(`${f} = $${idx++}`);
        params.push(req.body[f]);
      }
    });
    if (fields.length === 0) return res.status(400).json({ error: 'Sin campos' });
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE clientes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clientes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM clientes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Cliente eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Bebekoala Inventory corriendo en puerto ${PORT}`);
});
