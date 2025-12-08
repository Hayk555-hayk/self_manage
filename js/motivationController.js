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
  getDocs, // <-- ИСПРАВЛЕНО
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
        if(startDate && endDate) {
             loadLogsForUser(startDate, endDate); 
        }
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
};

export const deleteLog = async (id) => {
    if (confirm("Are you sure you want to delete this log entry?")) {
        await deleteDoc(doc(db, LOGS_COLLECTION, id));
        
        const startDate = qs('start-date').value;
        const endDate = qs('end-date').value;
        if(startDate && endDate) {
             loadLogsForUser(startDate, endDate); 
        }
    }
};

/**
 * Загружает логи мотивации с фильтрацией по диапазону дат.
 */
export const loadLogsForUser = (startDateStr, endDateStr) => {
    if (!currentUserId) return;
    
    const startTime = dateToTimestamp(startDateStr);
    const endTime = dateToTimestampEnd(endDateStr);

    const q = query(
        collection(db, LOGS_COLLECTION),
        where("userId", "==", currentUserId),
        where("timestamp", ">=", startTime),
        where("timestamp", "<=", endTime),
        orderBy("timestamp", "asc")
    );

    getDocs(q).then((snapshot) => {
        const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        renderMotivationChart(logs);
        renderLogHistory(logs);
    }).catch(error => {
        console.error("Error loading motivation logs:", error);
    });
}


// --- ФУНКЦИЯ ГРАФИКА ---

function renderMotivationChart(logs) {
    if (!allGoals || allGoals.length === 0) {
        if (chartMotivation) chartMotivation.destroy();
        return; 
    }

    const { dates, scoresByGoal } = aggregateLogsByGoalAndDate(logs);
    
    const datasets = allGoals.map((goal) => {
        const goalScores = scoresByGoal[goal.id] || {};
        const color = getRandomColor();
        
        const data = dates.map(date => goalScores[date] || 0);
        
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
            labels: dates,
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
                        text: 'Daily Score Sum'
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
                    text: 'Progress Per Goal (Filtered Period)'
                }
            }
        }
    });
}

// --- ФУНКЦИЯ АГРЕГАЦИИ ---

function aggregateLogsByGoalAndDate(logs) {
    const scoresByGoal = {};
    const uniqueDates = new Set();
    
    logs.forEach(log => {
        const dateKey = new Date(log.timestamp).toISOString().substring(0, 10);
        uniqueDates.add(dateKey);

        const goalId = log.goalId;
        const score = log.score;

        if (!scoresByGoal[goalId]) {
            scoresByGoal[goalId] = {};
        }

        scoresByGoal[goalId][dateKey] = (scoresByGoal[goalId][dateKey] || 0) + score;
    });

    const sortedDates = Array.from(uniqueDates).sort();

    return { dates: sortedDates, scoresByGoal };
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
    
    // 3. Загружаем логи, используя начальный диапазон дат
    loadLogsForUser(qs('start-date').value, qs('end-date').value);
};