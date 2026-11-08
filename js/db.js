import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  serverTimestamp,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

const CATEGORIES_COL = "categories";
const ITEMS_COL = "items";

/**
 * Real-time listener for Categories sorted by manual order
 */
export function subscribeToCategories(onData, onError) {
  const q = query(collection(db, CATEGORIES_COL), orderBy("order", "asc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const categories = [];
      snapshot.forEach((docSnap) => {
        categories.push({ id: docSnap.id, ...docSnap.data() });
      });
      onData(categories);
    },
    (err) => {
      console.error("Categories snapshot error:", err);
      if (onError) onError(err);
    }
  );
}

/**
 * Real-time listener for Items
 */
export function subscribeToItems(onData, onError) {
  const q = collection(db, ITEMS_COL);
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...docSnap.data() });
      });
      onData(items);
    },
    (err) => {
      console.error("Items snapshot error:", err);
      if (onError) onError(err);
    }
  );
}

/**
 * Add a new Category
 */
export async function addCategory(name, nextOrder = 0) {
  const docRef = await addDoc(collection(db, CATEGORIES_COL), {
    name: name.trim(),
    order: Number(nextOrder) || Date.now(),
    createdAt: serverTimestamp()
  });
  return docRef.id;
}

/**
 * Update Category Name
 */
export async function updateCategory(id, name) {
  const catRef = doc(db, CATEGORIES_COL, id);
  await updateDoc(catRef, {
    name: name.trim()
  });
}

/**
 * Delete a category and cascade-delete all items inside it
 */
export async function deleteCategoryCascade(categoryId) {
  const batch = writeBatch(db);

  // 1. Delete category document
  const catRef = doc(db, CATEGORIES_COL, categoryId);
  batch.delete(catRef);

  // 2. Query and delete all items with categoryId
  const itemsQ = query(collection(db, ITEMS_COL), where("categoryId", "==", categoryId));
  const snap = await getDocs(itemsQ);
  snap.forEach((itemSnap) => {
    batch.delete(doc(db, ITEMS_COL, itemSnap.id));
  });

  await batch.commit();
}

/**
 * Batch update category ordering after drag & drop
 */
export async function updateCategoriesOrder(orderedCategories) {
  const batch = writeBatch(db);
  orderedCategories.forEach((cat, index) => {
    const catRef = doc(db, CATEGORIES_COL, cat.id);
    batch.update(catRef, { order: index });
  });
  await batch.commit();
}

/**
 * Add a new Item
 */
export async function addItem(data) {
  const nowIso = new Date().toISOString();
  const newItem = {
    name: data.name.trim(),
    categoryId: data.categoryId,
    unit: data.unit || "Nos",
    quantity: Number(data.quantity) || 1,
    oldPrice: Number(data.oldPrice) || 0,
    newPrice: Number(data.newPrice) || 0,
    priceTimestamp: nowIso,
    selected: Boolean(data.selected),
    order: Number(data.order) || Date.now(),
    createdAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, ITEMS_COL), newItem);
  return docRef.id;
}

/**
 * Update Item (auto-updates priceTimestamp if newPrice changes)
 */
export async function updateItem(id, data, currentItem = null) {
  const itemRef = doc(db, ITEMS_COL, id);
  const updates = {
    name: data.name.trim(),
    categoryId: data.categoryId,
    unit: data.unit,
    quantity: Number(data.quantity) || 1,
    oldPrice: Number(data.oldPrice) || 0,
    newPrice: Number(data.newPrice) || 0
  };

  if ("selected" in data) {
    updates.selected = Boolean(data.selected);
  }

  // Check if new price changed compared to current data
  if (currentItem && Number(currentItem.newPrice) !== Number(data.newPrice)) {
    updates.priceTimestamp = new Date().toISOString();
  }

  await updateDoc(itemRef, updates);
}

/**
 * Delete single Item
 */
export async function deleteItem(id) {
  await deleteDoc(doc(db, ITEMS_COL, id));
}

/**
 * Toggle Item Selection
 */
export async function setItemSelected(id, selected) {
  const itemRef = doc(db, ITEMS_COL, id);
  await updateDoc(itemRef, { selected: Boolean(selected) });
}

/**
 * Batch update items order within category
 */
export async function updateItemsOrder(orderedItems) {
  const batch = writeBatch(db);
  orderedItems.forEach((item, index) => {
    const itemRef = doc(db, ITEMS_COL, item.id);
    batch.update(itemRef, { order: index });
  });
  await batch.commit();
}

/**
 * Bulk update selected state for multiple items (Clear All & Undo)
 */
export async function bulkSetSelection(itemIds, selected) {
  if (!itemIds || itemIds.length === 0) return;
  const batch = writeBatch(db);
  itemIds.forEach((id) => {
    const itemRef = doc(db, ITEMS_COL, id);
    batch.update(itemRef, { selected: Boolean(selected) });
  });
  await batch.commit();
}
