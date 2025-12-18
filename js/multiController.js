import { db, auth } from "./firebase-config.js"; 
import {
  collection,
  addDoc,
  doc,
  deleteDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { qs } from "./ui.js"; 

// Статусы
const STATUSES = {
    IN_PROGRESS: 'in_progress',
    DONE: 'done',
    FAILED: 'failed'
};

// ===============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (ВЫНЕСЕНЫ ИЗ initGoals)
// ===============================================

/**
 * Создает выпадающий список для выбора статуса.
 * @param {string} id ID элемента (цели или подцели).
 * @param {string} currentStatus Текущий статус.
 * @param {'goal' | 'subgoal'} type Тип элемента.
 * @returns {HTMLSelectElement} Элемент Select.
 */
function createStatusDropdown(id, currentStatus, type) {
    const select = document.createElement('select');
    select.className = 'status-dropdown';
    
    const options = {
        [STATUSES.IN_PROGRESS]: 'Not Active',
        [STATUSES.DONE]: 'Active',
        [STATUSES.FAILED]: 'Failed'
    };

    for (const [key, value] of Object.entries(options)) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = value;
        if (key === currentStatus) {
            option.selected = true;
        }
        select.appendChild(option);
    }

    select.onclick = (e) => e.stopPropagation(); // Предотвращаем открытие модала при клике на select
    
    select.onchange = (e) => {
        if (type === 'goal') {
            updateGoalStatus(id, e.target.value);
        } else if (type === 'subgoal') {
            // dataset.parentId устанавливается в функции renderSubgoals
            updateSubgoalStatus(e.target.dataset.parentId, id, e.target.value);
        }
    };
    
    return select;
}

// ДОБАВЛЕНО: Функция для обновления статуса основной цели
async function updateGoalStatus(id, newStatus) {
    await updateDoc(doc(db, "goals", id), {
        status: newStatus
    });
}

// ===============================================
// ОСНОВНЫЕ ЦЕЛИ
// ===============================================

export function initGoals() {
  const form = qs("goal-form");
  const input = qs("goal-input");
  const list = qs("goal-list");

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
      createdAt: Date.now(),
      status: STATUSES.IN_PROGRESS, 
      subgoals: [] 
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
        li.className = `goal-item status-${goal.status || STATUSES.IN_PROGRESS}`; 
        li.dataset.id = id;
        li.dataset.title = goal.title;

        const titleSpan = document.createElement("span");
        titleSpan.textContent = goal.title;
        titleSpan.className = "goal-text";
        
        // ВЫЗЫВАЕМ ВЫНЕСЕННУЮ ФУНКЦИЮ
        const statusSelect = createStatusDropdown(id, goal.status, 'goal');

        const editBtn = document.createElement("button");
        editBtn.textContent = "✏️";
        editBtn.onclick = (e) => {
            e.stopPropagation(); 
            editGoal(id, goal.title);
        };

        const delBtn = document.createElement("button");
        delBtn.textContent = "🗑️";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteGoal(id);
        };

        li.appendChild(titleSpan);
        li.appendChild(statusSelect); 
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
    if (confirm("Вы уверены, что хотите удалить эту цель и все ее подцели?")) {
        await deleteDoc(doc(db, "goals", id));
    }
  }
}

// ===============================================
// ПОДЦЕЛИ
// ===============================================

export const addSubgoal = async (goalId, subgoalText) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Пользователь не авторизован.");

    const goalRef = doc(db, 'goals', goalId);
    
    const goalSnap = await getDoc(goalRef);
    if (!goalSnap.exists()) {
        throw new Error("Основная цель не найдена.");
    }
    
    const goalData = goalSnap.data();
    const newSubgoals = goalData.subgoals || [];

    newSubgoals.push({
        id: Date.now().toString(), 
        text: subgoalText,
        status: STATUSES.IN_PROGRESS 
    });

    await updateDoc(goalRef, { subgoals: newSubgoals });
    await renderSubgoals(goalId); // Перерисовываем после добавления
};


export const renderSubgoals = async (goalId) => {
    const subgoalList = qs('subgoal-list');
    subgoalList.innerHTML = '<li>Loading subgoals...</li>';
    
    const goalRef = doc(db, 'goals', goalId);
    const goalSnap = await getDoc(goalRef);
    
    if (!goalSnap.exists()) {
        subgoalList.innerHTML = '<li>Error: Goal not found.</li>';
        return;
    }

    const subgoals = goalSnap.data().subgoals || [];
    subgoalList.innerHTML = ''; 

    if (subgoals.length === 0) {
        subgoalList.innerHTML = '<li>No subgoals yet. Add the first one!</li>';
        return;
    }

    subgoals.forEach(subgoal => {
        const li = document.createElement('li');
        li.dataset.subgoalId = subgoal.id;
        li.className = `status-${subgoal.status || STATUSES.IN_PROGRESS}`;
        
        const textSpan = document.createElement('span');
        textSpan.textContent = subgoal.text;
        
        // ВЫЗЫВАЕМ ВЫНЕСЕННУЮ ФУНКЦИЮ
        const statusSelect = createStatusDropdown(subgoal.id, subgoal.status, 'subgoal');
        statusSelect.dataset.parentId = goalId; 
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '×';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteSubgoal(goalId, subgoal.id);
        };

        li.appendChild(textSpan);
        li.appendChild(statusSelect); 
        li.appendChild(deleteBtn);
        subgoalList.appendChild(li);
    });
};


export async function updateSubgoalStatus(goalId, subgoalId, newStatus) {
    const goalRef = doc(db, 'goals', goalId);
    const goalSnap = await getDoc(goalRef);
    if (!goalSnap.exists()) return;

    const goalData = goalSnap.data();
    let subgoals = goalData.subgoals || [];

    const updatedSubgoals = subgoals.map(s => {
        if (s.id === subgoalId) {
            return { ...s, status: newStatus };
        }
        return s;
    });

    await updateDoc(goalRef, { subgoals: updatedSubgoals });
    await renderSubgoals(goalId);
}


async function deleteSubgoal(goalId, subgoalId) {
    if (!confirm("Remove this sub-goal?")) return;

    const goalRef = doc(db, 'goals', goalId);
    
    try {
        const goalSnap = await getDoc(goalRef);
        const goalData = goalSnap.data();
        let subgoals = goalData.subgoals || [];

        const updatedSubgoals = subgoals.filter(s => s.id !== subgoalId);

        await updateDoc(goalRef, { subgoals: updatedSubgoals });

        await renderSubgoals(goalId); 
    } catch (e) {
        console.error("Error deleting sub-goal: ", e);
    }
}

export function initSelfTask() {
    document.querySelector('#self-task').style.display = 'block';
    highlightToday();
    initTaskPersistence();
} 

function highlightToday() {
    const date = new Date();
    let dayIndex = date.getDay(); // 0 (Вс) - 6 (Сб)

    // Преобразуем формат (0 - Пн, 1 - Вт, ... 6 - Вс), 
    // так как в вашей таблице Пн идет первым
    // (dayIndex + 6) % 7 делает так: Пн(1)->0, Вт(2)->1 ... Вс(0)->6
    const tableIndex = (dayIndex + 6) % 7;

    const table = document.querySelector('#self-task table');
    if (!table) return;

    const rows = table.querySelectorAll('tr');

    rows.forEach(row => {
        // Находим ячейку в строке по индексу дня
        const cell = row.cells[tableIndex];
        if (cell) {
            cell.classList.add('today-column');
        }
    });
}

function initTaskPersistence() {
    const table = document.querySelector('#self-task table');
    if (!table) return;

    const cells = table.querySelectorAll('td');
    const storageKey = 'schedule_done_tasks';

    // 1. Загружаем сохраненные индексы из localStorage
    let doneTasks = JSON.parse(localStorage.getItem(storageKey)) || [];

    // 2. Применяем сохраненный стиль ко всем ячейкам
    cells.forEach((cell, index) => {
        // Добавляем уникальный ID ячейке (для удобства)
        cell.dataset.index = index;

        // Если этот индекс есть в базе - красим
        if (doneTasks.includes(index)) {
            cell.classList.add('task-done');
        }

        // 3. Вешаем событие двойного клика (dblclick)
        cell.addEventListener('dblclick', () => {
            const isDone = cell.classList.toggle('task-done');
            
            // Обновляем массив индексов
            if (isDone) {
                if (!doneTasks.includes(index)) doneTasks.push(index);
            } else {
                doneTasks = doneTasks.filter(id => id !== index);
            }

            // Сохраняем обратно в localStorage
            localStorage.setItem(storageKey, JSON.stringify(doneTasks));
        });
    });
}