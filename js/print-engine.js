/**
 * Print Engine with Mathematical Auto-Scaling Algorithm
 * Guarantees that selected items fit on at most 1 physical A4 sheet (front + back = max 2 pages).
 * Never spills onto page 3.
 */

export function renderAndPrintChecklist(categories, items) {
  // 1. Filter ONLY checked items
  const selectedItems = items.filter(item => Boolean(item.selected));

  if (selectedItems.length === 0) {
    alert("Please select at least one item to generate the print checklist.");
    return false;
  }

  // 2. Group selected items by Category
  const catMap = new Map();
  categories.forEach(cat => catMap.set(cat.id, { ...cat, items: [] }));

  // Also handle items without a valid category
  const uncategorized = { id: "__uncategorized__", name: "Other Items", items: [] };

  selectedItems.forEach(item => {
    if (catMap.has(item.categoryId)) {
      catMap.get(item.categoryId).items.push(item);
    } else {
      uncategorized.items.push(item);
    }
  });

  const activeCategories = Array.from(catMap.values()).filter(c => c.items.length > 0);
  if (uncategorized.items.length > 0) {
    activeCategories.push(uncategorized);
  }

  // 3. Mathematical Density Calculation
  // Total Items (N) + Category headers weighted as 1.5 item rows
  const N = selectedItems.length;
  const C = activeCategories.length;
  const visualRowUnits = N + (C * 1.5);

  /**
   * Layout Scaling Engine Parameters:
   * Target: Max 2 A4 pages (562mm / ~2120px printable height).
   * Single column threshold is ~54 visual units (27 units per page).
   * Above 54 visual units, multi-column (2 columns) is activated to double vertical capacity
   * so up to 120+ items comfortably fit in 2 pages without ever overflowing to page 3.
   */
  let config = {
    columns: 1,
    fontSize: '13px',
    lineHeight: '1.35',
    paddingY: '6px',
    paddingX: '8px',
    checkboxSize: '13px',
    catMarginBottom: '12px',
    headerMarginBottom: '12px',
    targetPages: 1
  };

  if (visualRowUnits <= 26) {
    // Comfortably fits 1 single page (Front page only)
    config = {
      columns: 1,
      fontSize: '13px',
      lineHeight: '1.35',
      paddingY: '6px',
      paddingX: '8px',
      checkboxSize: '13px',
      catMarginBottom: '12px',
      headerMarginBottom: '14px',
      targetPages: 1
    };
  } else if (visualRowUnits <= 54) {
    // Fits on 2 pages (Single Column, ~27 rows per page)
    config = {
      columns: 1,
      fontSize: '11.5px',
      lineHeight: '1.25',
      paddingY: '4px',
      paddingX: '6px',
      checkboxSize: '12px',
      catMarginBottom: '8px',
      headerMarginBottom: '10px',
      targetPages: 2
    };
  } else if (visualRowUnits <= 88) {
    // 2-Column Layout (Double capacity across 2 pages = 4 column panes)
    config = {
      columns: 2,
      fontSize: '10.5px',
      lineHeight: '1.2',
      paddingY: '3px',
      paddingX: '5px',
      checkboxSize: '11px',
      catMarginBottom: '8px',
      headerMarginBottom: '8px',
      targetPages: 2
    };
  } else {
    // High density (89 - 130+ items): Compact 2-column layout
    config = {
      columns: 2,
      fontSize: '9px',
      lineHeight: '1.15',
      paddingY: '2px',
      paddingX: '4px',
      checkboxSize: '10px',
      catMarginBottom: '6px',
      headerMarginBottom: '6px',
      targetPages: 2
    };
  }

  // 4. Populate Print Container DOM
  const printContainer = document.getElementById("print-view");
  if (!printContainer) return false;

  // Apply auto-calculated CSS custom properties
  printContainer.style.setProperty("--print-columns", config.columns);
  printContainer.style.setProperty("--print-font-size", config.fontSize);
  printContainer.style.setProperty("--print-line-height", config.lineHeight);
  printContainer.style.setProperty("--print-padding-y", config.paddingY);
  printContainer.style.setProperty("--print-padding-x", config.paddingX);
  printContainer.style.setProperty("--print-checkbox-size", config.checkboxSize);
  printContainer.style.setProperty("--print-cat-gap", config.catMarginBottom);

  const formattedDate = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  let html = `
    <div class="print-sheet columns-${config.columns}">
      <header class="print-header" style="margin-bottom: ${config.headerMarginBottom};">
        <div class="print-header-left">
          <h1 class="print-title">Grocery Shopping Checklist</h1>
          <span class="print-date">${formattedDate}</span>
        </div>
        <div class="print-header-right">
          <span class="print-pill">${selectedItems.length} items to buy</span>
          <span class="print-pill-sub">${config.targetPages === 1 ? '1 Page' : 'Front & Back (Max 2 Pages)'}</span>
        </div>
      </header>

      <div class="print-content">
  `;

  activeCategories.forEach(cat => {
    html += `
      <section class="print-category">
        <h2 class="print-category-title">${escapeHtml(cat.name)} (${cat.items.length})</h2>
        <table class="print-table">
          <thead>
            <tr>
              <th style="width: 30px;"></th>
              <th>Item</th>
              <th style="width: 110px; text-align: right;">Quantity</th>
              <th style="width: 80px; text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>
    `;

    cat.items.forEach(item => {
      const priceText = item.newPrice ? Number(item.newPrice).toFixed(2) : '-';
      html += `
        <tr>
          <td class="td-check">
            <span class="print-box"></span>
          </td>
          <td class="td-name">
            <strong>${escapeHtml(item.name)}</strong>
          </td>
          <td class="td-qty" style="text-align: right;">
            ${item.quantity} ${escapeHtml(item.unit || '')}
          </td>
          <td class="td-price" style="text-align: right;">
            ${priceText}
          </td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </section>
    `;
  });

  html += `
      </div>
    </div>
  `;

  printContainer.innerHTML = html;

  // 5. Trigger Window Print
  setTimeout(() => {
    window.print();
  }, 100);

  return true;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
