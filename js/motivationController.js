import { db, auth } from "./firebase-config.js"; 
import {
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  deleteDoc,
  getDocs, 
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const GOALS_COLLECTION = 'goals';
const LOGS_COLLECTION = 'motivationLogs';
const qs = (id) => document.getElementById(id);

let chartMotivation = null;
let allGoals = []; 
let currentUserId = null; 

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ДАТ ---

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getCurrentMonthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    end.setHours(0, 0, 0, 0);

    return { startTime: start.getTime(), endTime: end.getTime() };
}

function dateToTimestamp(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    date.setHours(0, 0, 0, 0); 
    return date.getTime();
}

function dateToTimestampEnd(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    date.setHours(23, 59, 59, 999); 
    return date.getTime();
}


/**
 * Генерирует уникальный цвет для каждой линии графика
 */
function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// --- УПРАВЛЕНИЕ ЦЕЛЯМИ (GOALS) ---

export const addGoal = async (title) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    await addDoc(collection(db, GOALS_COLLECTION), {
        userId: user.uid,
        title: title,
        createdAt: Date.now()
    });
};

export const deleteGoal = async (id) => {
    if (confirm("Are you sure you want to delete this goal? All related logs will remain but won't be easily readable.")) {
        await deleteDoc(doc(db, GOALS_COLLECTION, id));
    }
};
window.deleteGoal = deleteGoal;

function subscribeToGoals(userId) {
    const q = query(
        collection(db, GOALS_COLLECTION),
        where("userId", "==", userId),
        orderBy("createdAt", "asc")
    );

    onSnapshot(q, (snapshot) => {
        allGoals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderGoals(allGoals);
        populateGoalSelect(allGoals);
        
        const startDate = qs('start-date').value;
        const endDate = qs('end-date').value;
        // Загружаем логи без фильтра по дате для правильного расчета кумулятивной суммы
        loadLogsForUser(); 
    });
}

function renderGoals(goals) {
    const list = qs('goals-list');
    list.innerHTML = '';
    goals.forEach(goal => {
        const li = document.createElement('li');
        li.className = 'goal-item';
        li.innerHTML = `
            <span class="goal-title">${goal.title}</span>
            <button onclick="deleteGoal('${goal.id}')" class="delete-goal-btn">🗑️</button>
        `;
        list.appendChild(li);
    });
}

function populateGoalSelect(goals) {
    const select = qs('goal-select');
    const firstOption = select.options[0];
    
    select.innerHTML = '';
    select.appendChild(firstOption); 
    
    goals.forEach(goal => {
        const option = document.createElement('option');
        option.value = goal.id;
        option.textContent = goal.title;
        select.appendChild(option);
    });
}

// --- УПРАВЛЕНИЕ ЛОГАМИ МОТИВАЦИИ (LOGS) ---

export const addMotivationLog = async (goalId, score, notes) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    await addDoc(collection(db, LOGS_COLLECTION), {
        userId: user.uid,
        goalId: goalId,
        score: score,
        notes: notes,
        timestamp: Date.now()
    });
    // После добавления лога обновляем данные, чтобы пересчитать кумулятивный график
    loadLogsForUser(); 
};

export const deleteLog = async (id) => {
    if (confirm("Are you sure you want to delete this log entry?")) {
        await deleteDoc(doc(db, LOGS_COLLECTION, id));
        // После удаления лога обновляем данные, чтобы пересчитать кумулятивный график
        loadLogsForUser(); 
    }
};

/**
 * Загружает ВСЕ логи мотивации для правильного расчета кумулятивной суммы.
 * Фильтрация по дате происходит в JS для отображения истории и графика.
 */
export const loadLogsForUser = () => {
    if (!currentUserId) return;
    
    // Запрашиваем ВСЕ логи, сортируя по дате, чтобы гарантировать правильный кумулятивный расчет.
    const q = query(
        collection(db, LOGS_COLLECTION),
        where("userId", "==", currentUserId),
        orderBy("timestamp", "asc")
    );

    getDocs(q).then((snapshot) => {
        const allLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Получаем текущий диапазон дат для фильтрации истории и графика
        const startDateStr = qs('start-date').value;
        const endDateStr = qs('end-date').value;
        const startTime = dateToTimestamp(startDateStr);
        const endTime = dateToTimestampEnd(endDateStr);

        // Фильтруем логи только для отображения в таблице истории
        const filteredLogs = allLogs.filter(log => 
             log.timestamp >= startTime && log.timestamp <= endTime
        );

        // Используем ВСЕ логи для КУМУЛЯТИВНОГО расчета, но отображаем только отфильтрованные данные
        renderMotivationChart(allLogs, startDateStr, endDateStr);
        renderLogHistory(filteredLogs);
    }).catch(error => {
        console.error("Error loading motivation logs:", error);
    });
}


// --- ФУНКЦИЯ ГРАФИКА ---

function renderMotivationChart(allLogs, startDateStr, endDateStr) {
    if (!allGoals || allGoals.length === 0) {
        if (chartMotivation) chartMotivation.destroy();
        return; 
    }

    // 1. Агрегация: Получаем кумулятивные данные
    const { cumulativeScoresByGoal, allSortedDates } = aggregateLogsByGoalAndDate(allLogs);
    
    const startTime = dateToTimestamp(startDateStr);
    const endTime = dateToTimestampEnd(endDateStr);
    
    // 2. Определяем метки для отображения (только в заданном диапазоне)
    const displayDates = allSortedDates.filter(dateKey => {
        const dateTimestamp = new Date(dateKey).getTime();
        return dateTimestamp >= startTime && dateTimestamp <= endTime;
    });

    // 3. Создаем наборы данных (datasets)
    const datasets = allGoals.map((goal) => {
        const color = getRandomColor();
        const cumulativeScores = cumulativeScoresByGoal[goal.id] || {};
        
        // Используем функцию, чтобы найти ближайшее предыдущее кумулятивное значение, 
        // чтобы график не начинался с нуля, если в первый день диапазона нет лога.
        const data = displayDates.map(dateKey => {
             // Ищем точное значение на эту дату
             if (cumulativeScores[dateKey] !== undefined) return cumulativeScores[dateKey];
             
             // Ищем ближайшее предыдущее значение (для ровной линии)
             const index = allSortedDates.indexOf(dateKey);
             for(let i = index; i >= 0; i--) {
                 if (cumulativeScores[allSortedDates[i]] !== undefined) {
                     return cumulativeScores[allSortedDates[i]];
                 }
             }
             return 0; // Начинаем с 0, если нет логов до начала диапазона
        });
        
        return {
            label: goal.title,
            data: data,
            borderColor: color,
            backgroundColor: color + '40',
            tension: 0.3,
            fill: false,
            pointRadius: 3
        };
    });

    if (chartMotivation) chartMotivation.destroy();

    chartMotivation = new Chart(qs('chartMotivation'), {
        type: 'line',
        data: {
            labels: displayDates,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        // Название изменено на "Кумулятивный счет"
                        text: 'Cumulative Score' 
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Date'
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                },
                title: {
                    display: true,
                    text: 'Cumulative Progress Per Goal (Filtered Period)'
                }
            }
        }
    });
}

// --- ФУНКЦИЯ АГРЕГАЦИИ (ИСПРАВЛЕНА НА КУМУЛЯТИВНУЮ СУММУ) ---

function aggregateLogsByGoalAndDate(logs) {
    const dailyScoresByGoal = {};
    const cumulativeScoresByGoal = {};
    const uniqueDates = new Set();
    
    // 1. Сначала рассчитываем ЕЖЕДНЕВНЫЕ суммы для каждой цели
    logs.forEach(log => {
        const dateKey = new Date(log.timestamp).toISOString().substring(0, 10);
        uniqueDates.add(dateKey);

        const goalId = log.goalId;
        const score = log.score;

        if (!dailyScoresByGoal[goalId]) {
            dailyScoresByGoal[goalId] = {};
        }
        // Суммируем все очки, добавленные за один день по одной цели
        dailyScoresByGoal[goalId][dateKey] = (dailyScoresByGoal[goalId][dateKey] || 0) + score;
    });

    const allSortedDates = Array.from(uniqueDates).sort();

    // 2. Затем рассчитываем КУМУЛЯТИВНУЮ сумму для каждой цели
    
    for (const goal of allGoals) {
        const goalId = goal.id;
        const dailyScores = dailyScoresByGoal[goalId] || {};
        cumulativeScoresByGoal[goalId] = {};
        
        let cumulativeSum = 0;
        
        // Итерируемся по ВСЕМ уникальным датам в хронологическом порядке
        for (const dateKey of allSortedDates) {
            const dailyIncrease = dailyScores[dateKey] || 0;
            cumulativeSum += dailyIncrease;
            cumulativeScoresByGoal[goalId][dateKey] = cumulativeSum;
        }
    }
    
    // Возвращаем кумулятивные данные и все даты (для построения графика)
    return { cumulativeScoresByGoal, allSortedDates };
}


// --- ИСТОРИЯ ЛОГОВ ---

function renderLogHistory(logs) {
    const list = qs('log-history-list');
    list.innerHTML = '';
    
    const sortedLogs = [...logs].sort((a, b) => b.timestamp - a.timestamp);

    sortedLogs.forEach(log => {
        const goal = allGoals.find(g => g.id === log.goalId);
        const goalTitle = goal ? goal.title : 'Goal Not Found (Deleted)';
        
        const date = new Date(log.timestamp).toLocaleDateString() + ' ' + new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const li = document.createElement('li');
        li.className = 'log-item';
        li.innerHTML = `
            <div class="log-info">
                <span class="goal-title">${goalTitle}</span>
                <span class="score">${log.score > 0 ? '+' : ''}${log.score}</span>
                <span class="notes">${log.notes || 'No notes'}</span>
                <span class="date">${date}</span>
            </div>
            <button onclick="deleteLog('${log.id}')" class="delete-log-btn">🗑️</button>
        `;
        list.appendChild(li);
    });
}


// --- ИНИЦИАЛИЗАЦИЯ КОНТРОЛЛЕРА ---

export const initMotivationController = (userId) => {
    currentUserId = userId;
    
    // 1. Установка начального диапазона дат (Текущий месяц)
    const { startTime, endTime } = getCurrentMonthRange();
    const startDate = new Date(startTime);
    const endDate = new Date(endTime - 1); 

    qs('start-date').value = formatDate(startDate);
    qs('end-date').value = formatDate(endDate); 

    // 2. Начинаем с подписки на цели (Goals)
    subscribeToGoals(userId); 
    
    // 3. Добавляем слушатели на изменение дат для обновления графика
    qs('start-date').addEventListener('change', loadLogsForUser);
    qs('end-date').addEventListener('change', loadLogsForUser);
};