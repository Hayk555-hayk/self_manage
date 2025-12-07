// multicontroller.js
import { db, auth } from "./firebase-config.js";
import {
  collection,
  addDoc,
  doc,
  deleteDoc,
  updateDoc,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

export function initGoals() {
  const form = document.getElementById("goal-form");
  const input = document.getElementById("goal-input");
  const list = document.getElementById("goal-list");

  let userId = null;

  auth.onAuthStateChanged(user => {
    if (!user) {
      list.innerHTML = "";
      return;
    }

    userId = user.uid;
    loadGoals();
  });

  form.addEventListener("submit", async e => {
    e.preventDefault();

    const title = input.value.trim();
    if (!title) return;

    await addDoc(collection(db, "goals"), {
      title,
      userId,
      createdAt: Date.now()
    });

    input.value = "";
  });

  function loadGoals() {
    const q = query(collection(db, "goals"), where("userId", "==", userId));

    onSnapshot(q, snapshot => {
      list.innerHTML = "";

      snapshot.forEach(docSnap => {
        const id = docSnap.id;
        const goal = docSnap.data();

        const li = document.createElement("li");
        li.textContent = goal.title;

        const editBtn = document.createElement("button");
        editBtn.textContent = "✏️";
        editBtn.onclick = () => editGoal(id, goal.title);

        const delBtn = document.createElement("button");
        delBtn.textContent = "🗑️";
        delBtn.onclick = () => deleteGoal(id);

        li.appendChild(editBtn);
        li.appendChild(delBtn);

        list.appendChild(li);
      });
    });
  }

  async function editGoal(id, oldTitle) {
    const newTitle = prompt("Новое название:", oldTitle);
    if (!newTitle || !newTitle.trim()) return;

    await updateDoc(doc(db, "goals", id), {
      title: newTitle.trim()
    });
  }

  async function deleteGoal(id) {
    await deleteDoc(doc(db, "goals", id));
  }
}
