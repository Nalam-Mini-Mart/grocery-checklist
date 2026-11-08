import {
  subscribeToCategories,
  subscribeToItems,
  addCategory,
  updateCategory,
  deleteCategoryCascade,
  updateCategoriesOrder,
  addItem,
  updateItem,
  deleteItem,
  setItemSelected,
  updateItemsOrder,
  bulkSetSelection
} from "./db.js";

import { renderAndPrintChecklist } from "./print-engine.js";

// Global In-Memory State
let categories = [];
let items = [];
let categorySortModes = {}; // { [categoryId]: 'manual' | 'asc' | 'desc' }
let searchQuery = "";
let isPriceBlurred = false;
let undoTimer = null;
let lastClearedItems = [];

// Drag and Drop State
let draggedCategoryIndex = null;
let draggedItemInfo = null; // { categoryId, itemIndex }

// Pending Deletion Action for Confirmation Modal
let pendingConfirmAction = null;

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
  initServiceWorker();
  initNetworkListeners();
  initEventListeners();
  initDataSubscriptions();
});

/* -----------------------------------------------------------
   Service Worker & Offline Status
----------------------------------------------------------- */
function initServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        console.log("Service Worker registered with scope:", reg.scope);
      })
      .catch((err) => {
        console.warn("Service Worker registration failed:", err);
      });
  }
}

function initNetworkListeners() {
  const banner = document.getElementById("offline-banner");
  const statusText = document.getElementById("sync-status-text");
  const statusBadge = document.getElementById("sync-status");

  function updateStatus() {
    const isOnline = navigator.onLine;
    if (isOnline) {
      banner.classList.remove("visible");
      statusText.textContent = "Cloud Synced";
      statusBadge.style.background = "var(--primary-light)";
      statusBadge.style.color = "#2dd4bf";
      statusBadge.style.borderColor = "var(--primary-border)";
    } else {
      banner.classList.add("visible");
      statusText.textContent = "Offline Mode (Local)";
      statusBadge.style.background = "var(--amber-light)";
      statusBadge.style.color = "var(--amber)";
      statusBadge.style.borderColor = "rgba(245, 158, 11, 0.3)";
    }
  }

  window.addEventListener("online", updateStatus);
  window.addEventListener("offline", updateStatus);
  updateStatus();
}

/* -----------------------------------------------------------
   Firestore Subscriptions
----------------------------------------------------------- */
function initDataSubscriptions() {
  subscribeToCategories(
    (newCategories) => {
      categories = newCategories;
      renderApp();
    },
    (err) => console.error("Error subscribing to categories:", err)
  );

  subscribeToItems(
    (newItems) => {
      items = newItems;
      renderApp();
    },
    (err) => console.error("Error subscribing to items:", err)
  );
}

/* -----------------------------------------------------------
   Event Listeners Setup
----------------------------------------------------------- */
function initEventListeners() {
  // Add Category Button
  document.getElementById("btn-add-category").addEventListener("click", () => openCategoryModal());
  document.getElementById("btn-empty-add-category").addEventListener("click", () => openCategoryModal());

  // Add Item Button
  document.getElementById("btn-add-item").addEventListener("click", () => openItemModal());

  // Print Checklist Button
  document.getElementById("btn-print-checklist").addEventListener("click", () => {
    renderAndPrintChecklist(categories, items);
  });

  // Search Bar
  const searchInput = document.getElementById("search-input");
  const clearSearchBtn = document.getElementById("clear-search");

  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    clearSearchBtn.style.display = searchQuery ? "block" : "none";
    renderApp();
  });

  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    clearSearchBtn.style.display = "none";
    renderApp();
  });

  // Clear All Selection with Undo
  document.getElementById("btn-clear-selection").addEventListener("click", handleClearAllSelection);

  // Discreet Total Visibility Toggle
  document.getElementById("toggle-privacy-btn").addEventListener("click", togglePricePrivacy);

  // Category Form Submit
  document.getElementById("category-form").addEventListener("submit", handleCategoryFormSubmit);
  document.getElementById("btn-close-category-modal").addEventListener("click", closeCategoryModal);
  document.getElementById("btn-cancel-category").addEventListener("click", closeCategoryModal);

  // Item Form Submit
  document.getElementById("item-form").addEventListener("submit", handleItemFormSubmit);
  document.getElementById("btn-close-item-modal").addEventListener("click", closeItemModal);
  document.getElementById("btn-cancel-item").addEventListener("click", closeItemModal);

  // Confirmation Modal
  document.getElementById("btn-confirm-action").addEventListener("click", () => {
    if (typeof pendingConfirmAction === "function") {
      pendingConfirmAction();
    }
    closeConfirmModal();
  });
  document.getElementById("btn-confirm-cancel").addEventListener("click", closeConfirmModal);
  document.getElementById("btn-close-confirm-modal").addEventListener("click", closeConfirmModal);

  // Close modals on overlay click
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.classList.remove("open");
      }
    });
  });
}

/* -----------------------------------------------------------
   Core UI Rendering
----------------------------------------------------------- */
function renderApp() {
  const container = document.getElementById("categories-container");
  const emptyState = document.getElementById("empty-state");

  if (!container) return;

  if (categories.length === 0) {
    container.innerHTML = "";
    emptyState.style.display = "block";
    updateCounters();
    return;
  }

  emptyState.style.display = "none";

  // Build HTML for each Category Card
  let html = "";

  categories.forEach((cat, catIndex) => {
    // Filter and sort items within this category
    const catItems = getProcessedCategoryItems(cat.id);
    const totalCatItems = items.filter(i => i.categoryId === cat.id).length;

    // If search active and no items match, hide category
    if (searchQuery && catItems.length === 0 && !cat.name.toLowerCase().includes(searchQuery)) {
      return;
    }

    const sortMode = categorySortModes[cat.id] || "manual";
    const sortBadgeText = sortMode === "asc" ? "A-Z ↑" : sortMode === "desc" ? "Z-A ↓" : "A-Z";
    const isSortActive = sortMode !== "manual";

    html += `
      <article 
        class="category-card" 
        data-cat-id="${cat.id}" 
        data-cat-index="${catIndex}"
        draggable="true"
      >
        <header class="category-header">
          <div class="category-title-area">
            <span class="drag-handle cat-drag-handle" title="Drag to reorder category">⋮⋮</span>
            <span class="category-name-text">${escapeHtml(cat.name)}</span>
            <span class="category-count-badge">${totalCatItems} ${totalCatItems === 1 ? 'item' : 'items'}</span>
          </div>
          <div class="category-header-controls">
            <button 
              class="sort-az-btn ${isSortActive ? 'active' : ''}" 
              data-cat-id="${cat.id}"
              title="Toggle A-Z alphabetical sorting for this category"
            >
              <span>${sortBadgeText}</span>
            </button>
            <button class="btn btn-secondary btn-sm" data-action="add-item-to-cat" data-cat-id="${cat.id}">
              + Add
            </button>
            <button class="btn-icon-only" data-action="edit-cat" data-cat-id="${cat.id}" title="Rename category">
              ✏️
            </button>
            <button class="btn-icon-only" data-action="delete-cat" data-cat-id="${cat.id}" title="Delete category">
              🗑️
            </button>
          </div>
        </header>

        <div class="table-wrapper">
          <table class="grocery-table">
            <thead>
              <tr>
                <th style="width: 32px;"></th>
                <th style="width: 44px; text-align: center;">Pick</th>
                <th>Item Name</th>
                <th style="width: 130px;">Quantity</th>
                <th style="width: 160px;">Price (Old / New)</th>
                <th style="width: 140px;">Price Updated</th>
                <th style="width: 80px; text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody data-cat-id="${cat.id}">
    `;

    if (catItems.length === 0) {
      html += `
        <tr>
          <td colspan="7" class="empty-category-notice">
            ${searchQuery ? 'No items match your search.' : 'No items yet in this category. Click "+ Add" to create one.'}
          </td>
        </tr>
      `;
    } else {
      catItems.forEach((item, itemIdx) => {
        const isSelected = Boolean(item.selected);
        const formattedDate = formatTimestamp(item.priceTimestamp);
        const oldPriceDisplay = item.oldPrice ? `₹${Number(item.oldPrice).toFixed(2)}` : '-';
        const newPriceDisplay = item.newPrice ? `₹${Number(item.newPrice).toFixed(2)}` : '-';

        html += `
          <tr 
            class="${isSelected ? 'row-selected' : ''}" 
            data-item-id="${item.id}"
            data-item-index="${itemIdx}"
            data-cat-id="${cat.id}"
            draggable="true"
          >
            <td style="width: 32px; text-align: center;">
              <span class="drag-handle item-drag-handle" title="Drag to reorder item">⋮⋮</span>
            </td>
            <td class="checkbox-cell">
              <input 
                type="checkbox" 
                class="custom-checkbox" 
                data-action="toggle-select" 
                data-item-id="${item.id}" 
                ${isSelected ? 'checked' : ''}
              >
            </td>
            <td class="item-name-cell">
              <span>${escapeHtml(item.name)}</span>
            </td>
            <td>
              <span class="quantity-badge">${item.quantity} ${escapeHtml(item.unit || '')}</span>
            </td>
            <td>
              <div class="price-container">
                <span class="old-price" title="Previous price">${oldPriceDisplay}</span>
                <span style="color: var(--text-subtle);">→</span>
                <span class="new-price" title="Current price">${newPriceDisplay}</span>
              </div>
            </td>
            <td>
              <span class="timestamp-badge" title="Auto-recorded when price changed">
                🕒 ${formattedDate}
              </span>
            </td>
            <td class="row-actions-cell">
              <button class="btn-icon-only" data-action="edit-item" data-item-id="${item.id}" title="Edit item">✏️</button>
              <button class="btn-icon-only" data-action="delete-item" data-item-id="${item.id}" title="Delete item">🗑️</button>
            </td>
          </tr>
        `;
      });
    }

    html += `
            </tbody>
          </table>
        </div>
      </article>
    `;
  });

  container.innerHTML = html;

  // Bind dynamic handlers & drag/drop
  attachCategoryCardListeners();
  attachItemRowListeners();
  updateCounters();
}

/* -----------------------------------------------------------
   Sorting & Search Processing
----------------------------------------------------------- */
function getProcessedCategoryItems(categoryId) {
  let catItems = items.filter(item => item.categoryId === categoryId);

  // Apply search filter if active
  if (searchQuery) {
    catItems = catItems.filter(item => 
      item.name.toLowerCase().includes(searchQuery) ||
      (item.unit && item.unit.toLowerCase().includes(searchQuery))
    );
  }

  // Apply Per-Category Sorting Mode
  const mode = categorySortModes[categoryId] || "manual";

  if (mode === "asc") {
    catItems.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } else if (mode === "desc") {
    catItems.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }));
  } else {
    // Manual order
    catItems.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  }

  return catItems;
}

/* -----------------------------------------------------------
   Calculations: Counters & Discreet Total Cost
----------------------------------------------------------- */
function updateCounters() {
  const selectedItems = items.filter(item => Boolean(item.selected));
  
  // Update Selection Counter
  const counterEl = document.getElementById("selected-counter");
  if (counterEl) {
    counterEl.textContent = `${selectedItems.length} ${selectedItems.length === 1 ? 'item' : 'items'} selected`;
  }

  // Calculate Discreet Total Cost (sum of 'New Price' for selected items)
  const totalCost = selectedItems.reduce((acc, item) => {
    return acc + (Number(item.newPrice) || 0);
  }, 0);

  const totalEl = document.getElementById("total-amount");
  if (totalEl) {
    totalEl.textContent = `₹${totalCost.toFixed(2)}`;
    if (isPriceBlurred) {
      totalEl.classList.add("blurred");
    } else {
      totalEl.classList.remove("blurred");
    }
  }
}

function togglePricePrivacy() {
  isPriceBlurred = !isPriceBlurred;
  const icon = document.getElementById("privacy-icon");
  const totalEl = document.getElementById("total-amount");

  if (isPriceBlurred) {
    icon.textContent = "🙈";
    totalEl.classList.add("blurred");
  } else {
    icon.textContent = "👁️";
    totalEl.classList.remove("blurred");
  }
}

/* -----------------------------------------------------------
   Clear All & Undo Mechanism
----------------------------------------------------------- */
async function handleClearAllSelection() {
  const selected = items.filter(i => Boolean(i.selected));
  if (selected.length === 0) {
    showToast("No items are currently selected.", null);
    return;
  }

  lastClearedItems = selected.map(i => i.id);

  try {
    // Uncheck all selected items in database
    await bulkSetSelection(lastClearedItems, false);

    // Trigger Temporary Undo Toast with 7-second countdown
    let secondsLeft = 7;
    const toastId = "undo-toast-" + Date.now();

    showUndoToast(
      `Cleared ${lastClearedItems.length} checked items.`,
      secondsLeft,
      async () => {
        // Undo clicked
        if (lastClearedItems.length > 0) {
          await bulkSetSelection(lastClearedItems, true);
          lastClearedItems = [];
          showToast("Restored selected items!", 2500);
        }
      }
    );
  } catch (err) {
    console.error("Error clearing selection:", err);
    showToast("Failed to clear selection. Please check connection.", 3000);
  }
}

function showUndoToast(message, durationSeconds, onUndo) {
  const toastContainer = document.getElementById("toast-container");
  if (!toastContainer) return;

  toastContainer.innerHTML = ""; // Clear existing toast

  const toast = document.createElement("div");
  toast.className = "toast";

  let remaining = durationSeconds;

  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="toast-undo-btn" id="toast-undo-btn">Undo (${remaining}s)</button>
  `;

  toastContainer.appendChild(toast);

  const undoBtn = toast.querySelector("#toast-undo-btn");

  if (undoTimer) clearInterval(undoTimer);

  undoTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(undoTimer);
      undoTimer = null;
      toast.remove();
    } else {
      undoBtn.textContent = `Undo (${remaining}s)`;
    }
  }, 1000);

  undoBtn.addEventListener("click", () => {
    clearInterval(undoTimer);
    undoTimer = null;
    toast.remove();
    onUndo();
  });
}

function showToast(message, duration = 3000) {
  const toastContainer = document.getElementById("toast-container");
  if (!toastContainer) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  if (duration) {
    setTimeout(() => {
      toast.remove();
    }, duration);
  }
}

/* -----------------------------------------------------------
   Category Header & Row Interactive Event Attachments
----------------------------------------------------------- */
function attachCategoryCardListeners() {
  // A-Z Sort button toggles
  document.querySelectorAll(".sort-az-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const catId = btn.dataset.catId;
      const current = categorySortModes[catId] || "manual";
      if (current === "manual") {
        categorySortModes[catId] = "asc";
      } else if (current === "asc") {
        categorySortModes[catId] = "desc";
      } else {
        categorySortModes[catId] = "manual";
      }
      renderApp();
    });
  });

  // Category Header Buttons
  document.querySelectorAll("[data-action='add-item-to-cat']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openItemModal(null, btn.dataset.catId);
    });
  });

  document.querySelectorAll("[data-action='edit-cat']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const cat = categories.find(c => c.id === btn.dataset.catId);
      if (cat) openCategoryModal(cat);
    });
  });

  document.querySelectorAll("[data-action='delete-cat']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const catId = btn.dataset.catId;
      const cat = categories.find(c => c.id === catId);
      if (!cat) return;

      const catItems = items.filter(i => i.categoryId === catId);
      const warningText = catItems.length > 0 
        ? `Are you sure you want to delete the category "${cat.name}" and ALL ${catItems.length} item(s) inside it? This action cannot be undone.`
        : `Are you sure you want to delete the category "${cat.name}"?`;

      openConfirmModal("Delete Category", warningText, async () => {
        try {
          await deleteCategoryCascade(catId);
          showToast(`Deleted category "${cat.name}".`);
        } catch (err) {
          console.error("Error deleting category:", err);
          showToast("Failed to delete category.");
        }
      });
    });
  });

  // Drag and drop for Categories
  const categoryCards = document.querySelectorAll(".category-card");
  categoryCards.forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      // Only drag if started on category header or handle, not on item table
      if (e.target.closest(".grocery-table")) return;
      draggedCategoryIndex = Number(card.dataset.catIndex);
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "category");
    });

    card.addEventListener("dragover", (e) => {
      if (draggedCategoryIndex === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      card.classList.add("drag-over");
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over");
    });

    card.addEventListener("drop", async (e) => {
      if (draggedCategoryIndex === null) return;
      e.preventDefault();
      card.classList.remove("drag-over");
      const targetIndex = Number(card.dataset.catIndex);

      if (draggedCategoryIndex !== targetIndex && targetIndex !== undefined) {
        // Reorder categories array
        const reordered = [...categories];
        const [movedCat] = reordered.splice(draggedCategoryIndex, 1);
        reordered.splice(targetIndex, 0, movedCat);

        // Optimistic UI update
        categories = reordered;
        renderApp();

        try {
          await updateCategoriesOrder(reordered);
        } catch (err) {
          console.error("Error updating category order:", err);
        }
      }
      draggedCategoryIndex = null;
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      draggedCategoryIndex = null;
      document.querySelectorAll(".category-card").forEach(c => c.classList.remove("drag-over"));
    });
  });
}

function attachItemRowListeners() {
  // Checkbox toggle
  document.querySelectorAll("[data-action='toggle-select']").forEach(chk => {
    chk.addEventListener("change", async (e) => {
      const itemId = chk.dataset.itemId;
      const isChecked = chk.checked;
      try {
        await setItemSelected(itemId, isChecked);
      } catch (err) {
        console.error("Error updating selection:", err);
      }
    });
  });

  // Edit Item button
  document.querySelectorAll("[data-action='edit-item']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = items.find(i => i.id === btn.dataset.itemId);
      if (item) openItemModal(item);
    });
  });

  // Delete Item button with STRICT confirmation
  document.querySelectorAll("[data-action='delete-item']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.itemId;
      const item = items.find(i => i.id === itemId);
      if (!item) return;

      openConfirmModal(
        "Delete Grocery Item",
        `Are you sure you want to permanently delete "${item.name}"?`,
        async () => {
          try {
            await deleteItem(itemId);
            showToast(`Deleted "${item.name}".`);
          } catch (err) {
            console.error("Error deleting item:", err);
            showToast("Failed to delete item.");
          }
        }
      );
    });
  });

  // Item Drag and Drop reordering within category
  const itemRows = document.querySelectorAll(".grocery-table tbody tr[draggable='true']");
  itemRows.forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      draggedItemInfo = {
        catId: row.dataset.catId,
        index: Number(row.dataset.itemIndex),
        itemId: row.dataset.itemId
      };
      row.classList.add("dragging-row");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "item");
    });

    row.addEventListener("dragover", (e) => {
      if (!draggedItemInfo) return;
      // Allow reordering within the same category
      if (draggedItemInfo.catId === row.dataset.catId) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        row.classList.add("drag-row-over");
      }
    });

    row.addEventListener("dragleave", (e) => {
      e.stopPropagation();
      row.classList.remove("drag-row-over");
    });

    row.addEventListener("drop", async (e) => {
      if (!draggedItemInfo) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drag-row-over");

      const targetCatId = row.dataset.catId;
      const targetIndex = Number(row.dataset.itemIndex);

      if (draggedItemInfo.catId === targetCatId && draggedItemInfo.index !== targetIndex) {
        const catItems = getProcessedCategoryItems(targetCatId);
        const [moved] = catItems.splice(draggedItemInfo.index, 1);
        catItems.splice(targetIndex, 0, moved);

        // Reset sort mode to manual so the user's custom drag-and-drop order is rendered
        categorySortModes[targetCatId] = "manual";
        renderApp();

        try {
          await updateItemsOrder(catItems);
        } catch (err) {
          console.error("Error updating items order:", err);
        }
      }
      draggedItemInfo = null;
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging-row");
      draggedItemInfo = null;
      document.querySelectorAll(".grocery-table tbody tr").forEach(r => r.classList.remove("drag-row-over"));
    });
  });
}

/* -----------------------------------------------------------
   Modals: Item, Category, and Confirmation
----------------------------------------------------------- */

// 1. Item Modal
function openItemModal(itemToEdit = null, defaultCatId = null) {
  const modal = document.getElementById("item-modal");
  const form = document.getElementById("item-form");
  const title = document.getElementById("item-modal-title");
  const categorySelect = document.getElementById("item-category");

  // Populate category options
  categorySelect.innerHTML = categories
    .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join("");

  if (categories.length === 0) {
    alert("Please create at least one category before adding items.");
    openCategoryModal();
    return;
  }

  form.reset();

  if (itemToEdit) {
    title.textContent = "Edit Grocery Item";
    document.getElementById("item-id").value = itemToEdit.id;
    document.getElementById("item-name").value = itemToEdit.name || "";
    categorySelect.value = itemToEdit.categoryId;
    document.getElementById("item-quantity").value = itemToEdit.quantity || 1;
    document.getElementById("item-unit").value = itemToEdit.unit || "Nos";
    document.getElementById("item-old-price").value = itemToEdit.oldPrice || "";
    document.getElementById("item-new-price").value = itemToEdit.newPrice || "";
  } else {
    title.textContent = "Add Grocery Item";
    document.getElementById("item-id").value = "";
    if (defaultCatId) {
      categorySelect.value = defaultCatId;
    }
  }

  modal.classList.add("open");
  document.getElementById("item-name").focus();
}

function closeItemModal() {
  document.getElementById("item-modal").classList.remove("open");
}

async function handleItemFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("item-id").value;
  const name = document.getElementById("item-name").value.trim();
  const categoryId = document.getElementById("item-category").value;
  const quantity = parseFloat(document.getElementById("item-quantity").value) || 1;
  const unit = document.getElementById("item-unit").value;
  const oldPrice = parseFloat(document.getElementById("item-old-price").value) || 0;
  const newPrice = parseFloat(document.getElementById("item-new-price").value) || 0;

  if (!name || !categoryId) return;

  const itemPayload = {
    name,
    categoryId,
    quantity,
    unit,
    oldPrice,
    newPrice
  };

  try {
    if (id) {
      // Editing item
      const current = items.find(i => i.id === id);
      await updateItem(id, itemPayload, current);
      showToast(`Updated "${name}".`);
    } else {
      // Adding new item
      itemPayload.selected = true; // Auto-select new items for shopping
      const existingInCat = items.filter(i => i.categoryId === categoryId);
      itemPayload.order = existingInCat.length;
      await addItem(itemPayload);
      showToast(`Added "${name}".`);
    }
    closeItemModal();
  } catch (err) {
    console.error("Error saving item:", err);
    showToast("Error saving item. Please try again.");
  }
}

// 2. Category Modal
function openCategoryModal(catToEdit = null) {
  const modal = document.getElementById("category-modal");
  const title = document.getElementById("category-modal-title");
  const form = document.getElementById("category-form");

  form.reset();

  if (catToEdit) {
    title.textContent = "Edit Category Name";
    document.getElementById("category-id").value = catToEdit.id;
    document.getElementById("category-name").value = catToEdit.name;
  } else {
    title.textContent = "Add New Category";
    document.getElementById("category-id").value = "";
  }

  modal.classList.add("open");
  document.getElementById("category-name").focus();
}

function closeCategoryModal() {
  document.getElementById("category-modal").classList.remove("open");
}

async function handleCategoryFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("category-id").value;
  const name = document.getElementById("category-name").value.trim();

  if (!name) return;

  try {
    if (id) {
      await updateCategory(id, name);
      showToast(`Renamed category to "${name}".`);
    } else {
      await addCategory(name, categories.length);
      showToast(`Created category "${name}".`);
    }
    closeCategoryModal();
  } catch (err) {
    console.error("Error saving category:", err);
    showToast("Error saving category.");
  }
}

// 3. Strict Confirmation Modal
function openConfirmModal(titleText, messageText, onConfirm) {
  const modal = document.getElementById("confirm-modal");
  document.getElementById("confirm-modal-title").textContent = titleText;
  document.getElementById("confirm-modal-message").textContent = messageText;
  pendingConfirmAction = onConfirm;
  modal.classList.add("open");
}

function closeConfirmModal() {
  document.getElementById("confirm-modal").classList.remove("open");
  pendingConfirmAction = null;
}

/* -----------------------------------------------------------
   Helper Utility Functions
----------------------------------------------------------- */
function formatTimestamp(isoString) {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  } catch {
    return "-";
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
