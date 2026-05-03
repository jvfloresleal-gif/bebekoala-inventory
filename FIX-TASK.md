# Task: Fix Bebekoala Inventory Frontend

## Problem
The HTML and JavaScript are completely mismatched:
- HTML was redesigned with animations and new IDs
- JS was written for a different HTML structure with different IDs

## JS expects these IDs (but they don't exist in HTML):
- `dashboardCards` → HTML has `statsGrid`
- `recentMovements` → not in HTML
- `stockAlerts` → not in HTML
- `productsList` → not in HTML (HTML has `productsTable`)
- `productCost` → HTML has `productCostPrice`
- `movementProductId` → not in HTML
- `movementProductResults` → not in HTML

## What to do:
1. Rewrite the JS functions (`loadDashboard`, `loadProducts`, `loadMovements`, `saveProduct`, `deleteProduct`, etc.) to match the new HTML structure
2. Use the correct IDs from the HTML:
   - `statsGrid` for dashboard cards
   - `barChart` for inventory value chart
   - `productsTable` for products list
   - `movementsTable` for movements list
   - `historyTable` for history list
3. Make sure the dashboard shows meaningful data from the API
4. Test all card values display properly

## API response format:
```json
{
  "totalProductos": 0,
  "valorInventario": 0,
  "bajosStock": 0,
  "sinStock": 0,
  "ultimosMovimientos": [],
  "productosBajos": []
}
```

File: `/Users/joaquinfloresleal/.openclaw/workspace/bebekoala-inventory/public/index.html`
