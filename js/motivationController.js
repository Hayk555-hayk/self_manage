import { db, auth } from "./firebase-config.js"; 
import {
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  doc
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const GOALS_COLLECTION = 'goals';
const LOGS_COLLECTION = 'motivationLogs';
const qs = (id) => document.getElementById(id);

let currentScoreChart = null;

/**
 * Инициализирует контроллер: загружает цели и подписывается на логи.
 */
export const initMotivationController = () => {
    auth.onAuthStateChanged(user => {
        if (user) {
            loadGoalsToDropdown(user.uid);
            subscribeToMotivationLogs(user.uid);
        }
    });
};

/**
 * Загружает главные цели в дропдаун.
 */
function loadGoalsToDropdown(userId) {
    const goalSelect = qs('goal-select');
    // Получаем только активные цели (предполагаем, что status !== 'done' и 'failed')
    const q = query(
        collection(db, GOALS_COLLECTION),
        where("userId", "==", userId),
        where("status", "in", ['in_progress', 'done']) // Берем все, что не удалено
    );

    onSnapshot(q, (snapshot) => {
        goalSelect.innerHTML = '<option value="" disabled selected>Select Main Goal</option>';
        snapshot.forEach(doc => {
            const goal = doc.data();
            const option = document.createElement('option');
            // Вставляем ID в value для записи в лог, а Title для отображения
            option.value = doc.id; 
            option.textContent = `${goal.title}`; 
            goalSelect.appendChild(option);
        });
    });
}

/**
 * Подписывается на логи мотивации и вызывает функции отрисовки.
 */
function subscribeToMotivationLogs(userId) {
    const q = query(
        collection(db, LOGS_COLLECTION),
        where("userId", "==", userId),
        orderBy("timestamp", "desc") // Сортировка для журнала активности
    );

    onSnapshot(q, (snapshot) => {
        const logs = snapshot.docs.map(doc => doc.data());
        
        // Переворачиваем для расчета кумулятивного счета (от старого к новому)
        const cumulativeLogs = [...logs].reverse(); 

        renderMotivationScore(cumulativeLogs);
        renderScoreChart(cumulativeLogs);
        renderActivityLog(logs);
    });
}

/**
 * Сохраняет новую запись о выполнении задачи.
 */
export const logScore = async (goalId, goalTitle, score, description) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    await addDoc(collection(db, LOGS_COLLECTION), {
        userId: user.uid,
        goalId: goalId,
        goalTitle: goalTitle,
        score: score,
        description: description,
        timestamp: Date.now()
    });
};


// --- ФУНКЦИИ ОТОБРАЖЕНИЯ ---

/**
 * Рендерит текущий общий счет.
 */
function renderMotivationScore(cumulativeLogs) {
    const scoreCard = qs('current-score');
    const totalScore = cumulativeLogs.reduce((sum, log) => sum + log.score, 0);

    scoreCard.textContent = totalScore;
    scoreCard.className = 'score-card'; // Сброс классов
    
    if (totalScore > 0) {
        scoreCard.classList.add('positive');
    } else if (totalScore < 0) {
        scoreCard.classList.add('negative');
    } else {
        scoreCard.classList.add('neutral');
    }
}

/**
 * Рендерит график динамики счета.
 */
function renderScoreChart(cumulativeLogs) {
    const ctx = qs('scoreChart');
    if (!ctx) return;

    let cumulativeSum = 0;
    const labels = [];
    const dataPoints = [];

    // Расчет кумулятивного счета
    cumulativeLogs.forEach(log => {
        cumulativeSum += log.score;
        labels.push(new Date(log.timestamp).toLocaleDateString());
        dataPoints.push(cumulativeSum);
    });

    if (currentScoreChart) currentScoreChart.destroy();
    
    currentScoreChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Cumulative Motivation Score',
                data: dataPoints,
                borderColor: '#9b59b6', // Фиолетовый
                backgroundColor: 'rgba(155, 89, 182, 0.2)',
                tension: 0.3,
                fill: true 
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

/**
 * Рендерит журнал активности.
 */
function renderActivityLog(logs) {
    const logList = qs('activity-log');
    logList.innerHTML = '';

    logs.forEach(log => {
        const li = document.createElement('li');
        const date = new Date(log.timestamp).toLocaleString();
        
        let scoreClass = 'zero';
        if (log.score > 0) scoreClass = 'positive';
        if (log.score < 0) scoreClass = 'negative';

        li.innerHTML = `
            <span class="log-score ${scoreClass}">${log.score > 0 ? '+' : ''}${log.score}</span>
            <span class="log-goal-title">[${log.goalTitle}]</span>
            <span class="log-description">${log.description || '(No notes)'}</span>
            <span style="float: right; color: #aaa;">${date}</span>
        `;
        logList.appendChild(li);
    });
}