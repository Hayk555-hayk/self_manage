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
  updateDoc,
  setDoc, // Для записи настроек
  getDoc // Для получения настроек
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const TRANSACTIONS_COLLECTION = 'transactions'; // Переменные: Expense, Bonus, Savings
const SETTINGS_COLLECTION = 'settings'; // Фиксированные: Salary, Debt
const qs = (id) => document.getElementById(id);

const charts = {
    totalFlow: null,
    variableBreakdown: null,
    timeFlow: null
};

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

function getStartTimestamp(period) {
    // ... (логика расчета временного штампа остается прежней) ...
    const now = new Date();
    let start = new Date(now);

    switch (period) {
        case 'day':
            start.setHours(0, 0, 0, 0);
            break;
        case 'week':
            start.setDate(now.getDate() - 7);
            break;
        case 'month':
            start.setMonth(now.getMonth() - 1);
            break;
        case 'year':
            start.setFullYear(now.getFullYear() - 1);
            break;
    }
    return start.getTime();
}

// --- УПРАВЛЕНИЕ ФИКСИРОВАННЫМИ НАСТРОЙКАМИ (Salary, Debt) ---

/**
 * Обновляет (или создает) фиксированные настройки для пользователя.
 */
export const updateFixedSettings = async (salary, debt) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    const settingsRef = doc(db, SETTINGS_COLLECTION, user.uid);
    await setDoc(settingsRef, {
        userId: user.uid,
        monthlySalary: salary,
        monthlyDebt: debt
    });
};

/**
 * Загружает фиксированные настройки и подписывается на изменения.
 */
function subscribeToSettings(userId) {
    const settingsRef = doc(db, SETTINGS_COLLECTION, userId);

    onSnapshot(settingsRef, (docSnap) => {
        let settings = { monthlySalary: 0, monthlyDebt: 0 };
        if (docSnap.exists()) {
            settings = docSnap.data();
        }
        renderFixedSettings(settings);
        // Перезагрузка транзакций, чтобы обновить метрики
        loadTransactions(userId, settings); 
    });
}

/**
 * Отображает текущие фиксированные настройки.
 */
function renderFixedSettings(settings) {
    const container = qs('current-settings');
    const format = (value) => `$${(value || 0).toFixed(2)}`;

    container.innerHTML = `
        <div class="metric-card">
            <h4>Fixed Monthly Salary</h4>
            <p class="fixed-value">${format(settings.monthlySalary)}</p>
        </div>
        <div class="metric-card">
            <h4>Fixed Monthly Debt</h4>
            <p class="debt-value">${format(settings.monthlyDebt)}</p>
        </div>
    `;
    qs('fixed-salary').value = settings.monthlySalary || '';
    qs('fixed-debt').value = settings.monthlyDebt || '';
}


// --- УПРАВЛЕНИЕ ПЕРЕМЕННЫМИ ТРАНЗАКЦИЯМИ (Expense, Bonus, Savings) ---

/**
 * Добавляет новую транзакцию.
 */
export const addTransaction = async (type, amount, description) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    await addDoc(collection(db, TRANSACTIONS_COLLECTION), {
        userId: user.uid,
        type: type,
        amount: amount,
        description: description,
        timestamp: Date.now()
    });
};

/**
 * Загружает переменные транзакции и передает их для рендеринга.
 */
function loadTransactions(userId, settings) {
    const period = qs('time-filter').value;
    const startTime = getStartTimestamp(period);

    const q = query(
        collection(db, TRANSACTIONS_COLLECTION),
        where("userId", "==", userId),
        where("timestamp", ">=", startTime),
        orderBy("timestamp", "asc")
    );

    onSnapshot(q, (snapshot) => {
        const variableData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Передаем и переменные данные, и фиксированные настройки для расчетов
        renderFinancialMetrics(variableData, settings);
        renderCharts(variableData, settings, period);
        renderTransactionHistory(variableData);
    });
}

// --- ИНИЦИАЛИЗАЦИЯ И КОНТРОЛЛЕР ---

export const initFinanceController = () => {
    auth.onAuthStateChanged(user => {
        if (user) {
            subscribeToSettings(user.uid); // Сначала загружаем настройки
            addInputValidation(); // Валидация
        }
    });
};

function renderCharts(variableData, settings, period) {
    renderChartTotalFlow(variableData, settings);
    renderChartVariableBreakdown(variableData);
    renderChartTimeFlow(variableData, period);
}


// --- ФУНКЦИИ ОТОБРАЖЕНИЯ МЕТРИК ---

function renderFinancialMetrics(data, settings) {
    const metricsContainer = qs('summary-metrics');
    
    const totals = data.reduce((acc, item) => {
        if (item.type === 'Bonus') acc.bonus += item.amount;
        if (item.type === 'Expense') acc.expense += item.amount;
        if (item.type === 'Savings_Deposit') acc.savings += item.amount;
        return acc;
    }, { bonus: 0, expense: 0, savings: 0 });

    const fixedSalary = settings.monthlySalary || 0;
    const fixedDebt = settings.monthlyDebt || 0;
    
    // МЕТРИКИ НА МЕСЯЦ (поскольку Fixed значения - месячные)
    const totalIncome = fixedSalary + totals.bonus;
    const totalExpense = fixedDebt + totals.expense;
    const netIncome = totalIncome - totalExpense;
    
    const format = (value) => `$${(value).toFixed(2)}`;
    
    metricsContainer.innerHTML = `
        <div class="metric-card">
            <h4>Total Monthly Income (Fixed + Bonus)</h4>
            <p class="saving-value">${format(totalIncome)}</p>
        </div>
        <div class="metric-card">
            <h4>Total Monthly Expenses (Fixed + Variable)</h4>
            <p class="debt-value">${format(totalExpense)}</p>
        </div>
        <div class="metric-card">
            <h4>Net Flow (Income - Expenses)</h4>
            <p class="${netIncome >= 0 ? 'saving-value' : 'debt-value'}">${format(netIncome)}</p>
        </div>
        <div class="metric-card">
            <h4>Variable Savings (This Period)</h4>
            <p class="fixed-value">${format(totals.savings)}</p>
        </div>
    `;
}

// --- ФУНКЦИИ ГРАФИКОВ ---

/**
 * 1. Общий Доход (Fixed+Variable) vs Общие Траты (Fixed+Variable) (Bar Chart)
 */
function renderChartTotalFlow(data, settings) {
    const fixedSalary = settings.monthlySalary || 0;
    const fixedDebt = settings.monthlyDebt || 0;

    const totalBonus = data.filter(d => d.type === 'Bonus').reduce((sum, d) => sum + d.amount, 0);
    const totalExpenseVariable = data.filter(d => d.type === 'Expense').reduce((sum, d) => sum + d.amount, 0);

    const totalIncome = fixedSalary + totalBonus;
    const totalExpense = fixedDebt + totalExpenseVariable;

    if (charts.totalFlow) charts.totalFlow.destroy();
    
    charts.totalFlow = new Chart(qs('chartTotalFlow'), {
        type: 'bar',
        data: {
            labels: ['Total Income', 'Total Expenses', 'Net'],
            datasets: [{
                label: 'USD (Monthly/Period)',
                data: [totalIncome, totalExpense, totalIncome - totalExpense],
                backgroundColor: ['#2ecc71', '#e74c3c', '#3498db'], 
                borderWidth: 1
            }]
        },
        options: { 
            responsive: true, 
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { display: false } }
        }
    });
}

/**
 * 2. Переменный Поток (Bonus vs Expenses) (Doughnut Chart)
 */
function renderChartVariableBreakdown(data) {
    const totalBonus = data.filter(d => d.type === 'Bonus').reduce((sum, d) => sum + d.amount, 0);
    const totalExpense = data.filter(d => d.type === 'Expense').reduce((sum, d) => sum + d.amount, 0);

    if (charts.variableBreakdown) charts.variableBreakdown.destroy();
    
    charts.variableBreakdown = new Chart(qs('chartVariableBreakdown'), {
        type: 'doughnut',
        data: {
            labels: ['Variable Expenses', 'Bonuses/Side Income'],
            datasets: [{
                data: [totalExpense, totalBonus],
                backgroundColor: ['#e74c3c', '#2ecc71'], 
                hoverOffset: 4
            }]
        },
        options: { 
            responsive: true, 
            aspectRatio: 1, 
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

/**
 * 3. Динамика переменного потока по периодам (Line Chart)
 */
function renderChartTimeFlow(data, period) {
    const aggregated = aggregateByPeriod(data, period);
    
    if (charts.timeFlow) charts.timeFlow.destroy();
    
    charts.timeFlow = new Chart(qs('chartTimeFlow'), {
        type: 'line',
        data: {
            labels: Object.keys(aggregated),
            datasets: [
                {
                    label: 'Net Variable Flow (Bonus - Expense)',
                    data: Object.values(aggregated).map(item => item.bonus - item.expense),
                    borderColor: '#3498db', // Синий
                    tension: 0.2,
                    fill: false,
                    yAxisID: 'y'
                },
                {
                    label: 'Savings Deposits',
                    data: Object.values(aggregated).map(item => item.savings),
                    borderColor: '#f1c40f', // Желтый
                    tension: 0.2,
                    fill: false,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            plugins: { title: { text: `Variable Flow by ${period.toUpperCase()}` } },
            scales: { y: { type: 'linear', display: true, position: 'left' } }
        }
    });
}

/**
 * Группирует переменные транзакции по периоду.
 */
function aggregateByPeriod(data, period) {
    const aggregates = {};

    data.forEach(item => {
        const date = new Date(item.timestamp);
        let key; 
        
        switch (period) {
            case 'day': key = date.toISOString().substring(0, 10); break;
            case 'week': key = `Week ${Math.ceil(date.getDate() / 7)}`; break;
            case 'month': key = `${date.getFullYear()}-${date.getMonth() + 1}`; break;
            case 'year': key = `${date.getFullYear()}`; break;
        }

        if (!aggregates[key]) {
            aggregates[key] = { expense: 0, bonus: 0, savings: 0 };
        }

        if (item.type === 'Bonus') aggregates[key].bonus += item.amount;
        if (item.type === 'Expense') aggregates[key].expense += item.amount;
        if (item.type === 'Savings_Deposit') aggregates[key].savings += item.amount;
    });

    return aggregates;
}


// --- ФУНКЦИИ ИСТОРИИ И УПРАВЛЕНИЯ (CRUD) ---

function renderTransactionHistory(data) {
    const historyList = qs('transaction-history-list');
    if (!historyList) return; 

    historyList.innerHTML = ''; 

    const sortedData = [...data].sort((a, b) => b.timestamp - a.timestamp);

    sortedData.forEach(item => {
        const li = document.createElement('li');
        li.className = `transaction-item ${item.type.toLowerCase()}`;
        
        const date = new Date(item.timestamp).toLocaleDateString();
        const formattedAmount = `$${item.amount.toFixed(2)}`;

        const editFunc = `editTransaction('${item.id}', '${item.type}', ${item.amount}, \`${item.description.replace(/'/g, "\\'")}\`)`;

        li.innerHTML = `
            <div class="transaction-info">
                <span class="type">${item.type}</span>
                <span class="description">${item.description}</span>
                <span class="amount">${formattedAmount}</span>
                <span class="date">${date}</span>
            </div>
            <div class="transaction-actions">
                <button onclick="${editFunc}" title="Edit">✏️</button>
                <button onclick="deleteTransaction('${item.id}')" title="Delete">🗑️</button>
            </div>
        `;
        historyList.appendChild(li);
    });
}

window.deleteTransaction = async (id) => {
    if (confirm("Are you sure you want to delete this financial record?")) {
        // Удаляем из коллекции TRANSACTIONS
        await deleteDoc(doc(db, TRANSACTIONS_COLLECTION, id));
    }
}

window.editTransaction = (id, currentType, currentAmount, currentDescription) => {
    const newAmountStr = prompt(`Enter new amount for ${currentDescription}:`, currentAmount);
    
    if (newAmountStr === null) return; 
    
    const newAmount = parseFloat(newAmountStr.replace(',', '.'));

    if (isNaN(newAmount) || newAmount < 0) {
        alert("Invalid amount entered. Please enter a positive number.");
        return;
    }

    const newDescription = prompt(`Enter new description for ${currentType}:`, currentDescription) || currentDescription;
    
    updateTransaction(id, newAmount, newDescription);
}

async function updateTransaction(id, amount, description) {
    // Обновляем в коллекции TRANSACTIONS
    const transactionRef = doc(db, TRANSACTIONS_COLLECTION, id);
    await updateDoc(transactionRef, {
        amount: amount,
        description: description
    });
}


// --- ФУНКЦИЯ ВАЛИДАЦИИ ВВОДА ---

function addInputValidation() {
    // Применяем валидацию к обоим полям ввода сумм
    ['fixed-salary', 'fixed-debt', 'amount-input'].forEach(id => {
        const input = qs(id);
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (!/[0-9.,]/.test(e.key)) {
                    e.preventDefault();
                }
            });
            input.addEventListener('change', () => {
                let value = input.value.replace(',', '.');
                value = value.replace(/[^\d.]/g, ''); 
                
                const parts = value.split('.');
                if (parts.length > 2) {
                    value = parts[0] + '.' + parts.slice(1).join('');
                }
                
                input.value = value;
            });
        }
    });
}