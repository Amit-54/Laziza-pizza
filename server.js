const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const player = require("play-sound")(); // ✅ Added to play sound

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Socket storage
let adminSockets = [];

io.on("connection", socket => {
  console.log("Socket connected:", socket.id);
  socket.on("admin-panel", () => {
    adminSockets.push(socket);
  });
  socket.on("disconnect", () => {
    adminSockets = adminSockets.filter(s => s.id !== socket.id);
  });
});

// Helpers
const getOrdersFile = date => path.join(DATA_DIR, `orders-${date}.json`);
const loadOrders = date => {
  const file = getOrdersFile(date);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
    return [];
  }
};
const saveOrders = (orders, date) => {
  fs.writeFileSync(getOrdersFile(date), JSON.stringify(orders, null, 2));
};

// API: get menu
app.get("/api/menu", (req, res) => {
  try {
    const menu = JSON.parse(fs.readFileSync(path.join(__dirname, "public", "menu.json"), "utf8"));
    res.json(menu);
  } catch (err) {
    res.status(500).json({ error: "Failed to load menu" });
  }
});

// API: update menu
app.post("/api/update-menu", (req, res) => {
  const menu = req.body;
  fs.writeFileSync(path.join(__dirname, "public", "menu.json"), JSON.stringify(menu, null, 2));
  res.json({ message: "Menu updated successfully" });
});

// API: get orders
app.get("/api/orders", (req, res) => {
  const date = req.query.date || new Date().toISOString().split("T")[0];
  try {
    const orders = loadOrders(date);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Failed to load orders" });
  }
});

// API: get single order
app.get("/api/orders/:id", (req, res) => {
  const date = req.query.date || new Date().toISOString().split("T")[0];
  const orders = loadOrders(date);
  const order = orders.find(o => o.orderId === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

// API: save order changes
app.post("/api/save-orders", (req, res) => {
  const { date, orders: updatedOrders } = req.body;
  if (!date || !updatedOrders) return res.status(400).json({ error: "Missing data" });

  try {
    const currentOrders = loadOrders(date);
    updatedOrders.forEach(updated => {
      const index = currentOrders.findIndex(o => o.orderId === updated.orderId);
      if (index !== -1) currentOrders[index] = updated;
    });
    saveOrders(currentOrders, date);
    res.json({ message: "Orders updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to save orders" });
  }
});

// API: create new order
app.post("/api/orders", (req, res) => {
  const order = req.body;
  const date = new Date().toISOString().split("T")[0];
  if (!order.items || order.items.length === 0) return res.status(400).json({ error: "Empty order" });

  try {
    const orders = loadOrders(date);
    order.orderId = "SB-" + Date.now();
    order.status = "Pending";
    order.timestamp = new Date().toISOString();
    order.total = order.items.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0);
    orders.push(order);
    saveOrders(orders, date);

    // ✅ Notify all admin panels
    adminSockets.forEach(s => s.emit("new-order", { orderId: order.orderId }));

    // ✅ Play sound on backend using external MP3 link
    player.play("https://cdn.glitch.global/9645b05c-396e-4189-b5ee-362d96b8d077/Untitled%20design%20(1).mp3?v=1748235467452", err => {
      if (err) console.error("Sound playback failed:", err);
    });

    res.json({ success: true, orderId: order.orderId });
  } catch (err) {
    res.status(500).json({ error: "Failed to create order" });
  }
});

// API: update order status
app.put("/api/orders/:id/status", (req, res) => {
  const { status } = req.body;
  const date = req.query.date || new Date().toISOString().split("T")[0];
  if (!status || !["Pending", "Preparing", "Completed"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const orders = loadOrders(date);
    const index = orders.findIndex(o => o.orderId === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Order not found" });

    orders[index].status = status;
    saveOrders(orders, date);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update status" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
