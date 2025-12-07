import { db, auth } from "./firebase-config.js"; 
import {
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const FINANCE_COLLECTION = 'financialData';
const qs = (id) => document.getElementById(id);

// Хранение экземпляров Chart.js
const charts = {
    incomeExpense: null,
    netWorth: null,
    timeFlow: null
};

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ДАТ ---

/**
 * Возвращает timestamp для начала выбранного периода.
 * @param {string} period 'day', 'week', 'month', 'year'
 * @returns {number} Timestamp начала периода.
 */
function getStartTimestamp(period) {
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


// --- ФУНКЦИИ ЗАПИСИ В FIREBASE ---

/**
 * Добавляет новую транзакцию в Firestore.
 * @param {string} type Income, Expense, Savings_Deposit, Credit_Payment, Debt_Added.
 * @param {number} amount Сумма.
 * @param {string} description Описание.
 */
export const addTransaction = async (type, amount, description) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    await addDoc(collection(db, FINANCE_COLLECTION), {
        userId: user.uid,
        type: type,
        amount: amount,
        description: description,
        timestamp: Date.now()
    });
};


// --- ФУНКЦИИ КОНТРОЛЛЕРА И ЗАГРУЗКИ ---

export const initFinanceController = () => {
    auth.onAuthStateChanged(user => {
        if (user) {
            loadFinancialData(user.uid);
        }
    });
};

function loadFinancialData(userId) {
    const period = qs('time-filter').value;
    const startTime = getStartTimestamp(period);

    // Запрос для получения всех транзакций за выбранный период (и сортировка для графиков)
    const q = query(
        collection(db, FINANCE_COLLECTION),
        where("userId", "==", userId),
        where("timestamp", ">=", startTime),
        orderBy("timestamp", "asc") // Сортировка по возрастанию для временных рядов
    );

    onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Передаем все данные для обработки и отрисовки
        renderFinancialMetrics(data);
        renderChartIncomeExpense(data); // 1. Зарплата (Доход) и Траты
        renderChartNetWorth(data);      // 2, 3, 4. Зарплата+Сбережения, Кредиты+Зарплата, Остаток
        renderChartTimeFlow(data, period); // 5. Динамика по периодам
    });
}


// --- ФУНКЦИИ ОТОБРАЖЕНИЯ МЕТРИК ---

function renderFinancialMetrics(data) {
    const metricsContainer = qs('summary-metrics');
    
    // Суммирование данных по категориям
    const totals = data.reduce((acc, item) => {
        if (item.type === 'Income' || item.type === 'Salary') acc.income += item.amount;
        if (item.type === 'Expense') acc.expense += item.amount;
        if (item.type === 'Savings_Deposit') acc.savings += item.amount;
        if (item.type === 'Credit_Payment' || item.type === 'Debt_Added') acc.debt += item.amount;
        return acc;
    }, { income: 0, expense: 0, savings: 0, debt: 0 });

    // Расчеты
    const netIncome = totals.income - totals.expense;
    const currentBalance = netIncome - totals.debt;
    
    const format = (value) => `$${value.toFixed(2)}`;
    
    metricsContainer.innerHTML = `
        <div class="metric-card">
            <h4>Total Income</h4>
            <p class="saving-value">${format(totals.income)}</p>
        </div>
        <div class="metric-card">
            <h4>Total Expenses</h4>
            <p class="debt-value">${format(totals.expense)}</p>
        </div>
        <div class="metric-card">
            <h4>Net Income (Income - Expenses)</h4>
            <p class="${netIncome >= 0 ? 'saving-value' : 'debt-value'}">${format(netIncome)}</p>
        </div>
        <div class="metric-card">
            <h4>Total Savings</h4>
            <p class="saving-value">${format(totals.savings)}</p>
        </div>
        <div class="metric-card">
            <h4>Current Financial Balance</h4>
            <p class="networth-value">${format(currentBalance)}</p>
        </div>
    `;
}

// --- ФУНКЦИИ ОТОБРАЖЕНИЯ ГРАФИКОВ CHART.JS ---

/**
 * 1. Зарплата/Доход и Траты (Bar Chart)
 */
function renderChartIncomeExpense(data) {
    const ctx = qs('chartIncomeExpense');
    if (!ctx) return;

    const totalIncome = data.filter(d => d.type === 'Income' || d.type === 'Salary').reduce((sum, d) => sum + d.amount, 0);
    const totalExpense = data.filter(d => d.type === 'Expense').reduce((sum, d) => sum + d.amount, 0);

    // Уничтожение старого графика
    if (charts.incomeExpense) charts.incomeExpense.destroy();
    
    charts.incomeExpense = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Total Income', 'Total Expenses'],
            datasets: [{
                label: 'AMD',
                data: [totalIncome, totalExpense],
                backgroundColor: ['#3498db', '#e74c3c'], // Синий vs Красный
                borderWidth: 1
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
                legend: { display: false },
                title: { display: false }
            }
        }
    });
}

/**
 * 2, 3, 4. Сводный график (Doughnut Chart)
 * Отражает соотношение: Сбережения / Долги / Остаток (Net Income - Savings - Debt)
 */
function renderChartNetWorth(data) {
    const ctx = qs('chartNetWorth');
    if (!ctx) return;

    const totalIncome = data.filter(d => d.type === 'Income' || d.type === 'Salary').reduce((sum, d) => sum + d.amount, 0);
    const totalExpense = data.filter(d => d.type === 'Expense').reduce((sum, d) => sum + d.amount, 0);
    const totalSavings = data.filter(d => d.type === 'Savings_Deposit').reduce((sum, d) => sum + d.amount, 0);
    const totalDebt = data.filter(d => d.type === 'Debt_Added').reduce((sum, d) => sum + d.amount, 0);

    const netIncome = totalIncome - totalExpense;
    const remainingBalance = netIncome - totalSavings - totalDebt;

    // Считаем все как положительные значения для Pie Chart
    const labels = ['Remaining Balance', 'Savings', 'Debt'];
    const amounts = [
        Math.max(0, remainingBalance), // Остаток (не может быть отрицательным на графике)
        totalSavings,
        totalDebt
    ];

    if (charts.netWorth) charts.netWorth.destroy();
    
    charts.netWorth = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: amounts,
                backgroundColor: [
                    '#3498db',  // Remaining (Синий)
                    '#f1c40f',  // Savings (Желтый)
                    '#e74c3c'   // Debt (Красный)
                ],
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            aspectRatio: 1,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

/**
 * 5. Финансы текущего дня/недели/месяца/года (Line Chart)
 */
function renderChartTimeFlow(data, period) {
    const ctx = qs('chartTimeFlow');
    if (!ctx) return;

    // Агрегация данных по дням/неделям (для Line Chart)
    const aggregated = aggregateByPeriod(data, period);
    
    if (charts.timeFlow) charts.timeFlow.destroy();
    
    charts.timeFlow = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Object.keys(aggregated),
            datasets: [
                {
                    label: 'Net Flow (Income - Expense)',
                    data: Object.values(aggregated).map(item => item.income - item.expense),
                    borderColor: '#2ecc71', // Зеленый
                    tension: 0.2,
                    fill: false,
                    yAxisID: 'y'
                },
                {
                    label: 'Savings Change',
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
            plugins: {
                legend: { position: 'top' },
                title: { text: `Financial Flow by ${period.toUpperCase()}` }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Amount (AMD)'
                    }
                }
            }
        }
    });
}

/**
 * Группирует транзакции по периоду (день, неделя, месяц).
 */
function aggregateByPeriod(data, period) {
    const aggregates = {};

    data.forEach(item => {
        const date = new Date(item.timestamp);
        let key; // Ключ для группировки (например, "2025-12-07" или "Week 49")
        
        switch (period) {
            case 'day':
                key = date.toISOString().substring(0, 10);
                break;
            case 'week':
                // Простое определение недели (может быть усложнено, но для Chart.js достаточно)
                key = `Week ${Math.ceil(date.getDate() / 7)}`;
                break;
            case 'month':
                key = `${date.getFullYear()}-${date.getMonth() + 1}`;
                break;
            case 'year':
                key = `${date.getFullYear()}`;
                break;
        }

        if (!aggregates[key]) {
            aggregates[key] = { income: 0, expense: 0, savings: 0 };
        }

        if (item.type === 'Income' || item.type === 'Salary') aggregates[key].income += item.amount;
        if (item.type === 'Expense') aggregates[key].expense += item.amount;
        if (item.type === 'Savings_Deposit') aggregates[key].savings += item.amount;
    });

    return aggregates;
}

// --- ФУНКЦИИ УДАЛЕНИЯ ---

window.deleteFinanceItem = async (id) => {
    // В текущей версии нет списка для удаления, но функция остается для будущих обновлений
    if (confirm("Are you sure you want to delete this financial record?")) {
        await deleteDoc(doc(db, FINANCE_COLLECTION, id));
    }
}