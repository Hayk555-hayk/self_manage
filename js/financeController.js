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
  setDoc,
  getDoc // Добавлен getDoc
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const TRANSACTIONS_COLLECTION = 'transactions'; 
const SETTINGS_COLLECTION = 'settings'; 
const TOTAL_DEBT_COLLECTION = 'totalDebt';        // НОВАЯ КОЛЛЕКЦИЯ
const REPAYMENT_LOGS_COLLECTION = 'repaymentLogs'; // НОВАЯ КОЛЛЕКЦИЯ

const qs = (id) => document.getElementById(id);

const charts = {
    fixedObligations: null, 
    fixedBreakdown: null,   
    totalFlow: null,        
    variableBreakdown: null,
    debtTracker: null // НОВЫЙ ГРАФИК
};

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

// --- УПРАВЛЕНИЕ ФИКСИРОВАННЫМИ НАСТРОЙКАМИ (Salary, Debt, Savings) ---

export const updateFixedSettings = async (salary, debt, savings) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    const settingsRef = doc(db, SETTINGS_COLLECTION, user.uid);
    await setDoc(settingsRef, {
        userId: user.uid,
        monthlySalary: salary,
        monthlyDebt: debt,
        fixedSavings: savings
    });
};

function renderFixedSettings(settings) {
    const container = qs('current-settings');
    const format = (value) => `$${(value || 0).toFixed(2)}`;

    container.innerHTML = `
        <div class="metric-card">
            <h4>Fixed Monthly Salary</h4>
            <p class="saving-value">${format(settings.monthlySalary)}</p>
        </div>
        <div class="metric-card">
            <h4>Fixed Monthly Debt</h4>
            <p class="debt-value">${format(settings.monthlyDebt)}</p>
        </div>
        <div class="metric-card">
            <h4>Fixed Monthly Savings</h4>
            <p class="fixed-value">${format(settings.fixedSavings)}</p>
        </div>
    `;
    qs('fixed-salary').value = settings.monthlySalary || '';
    qs('fixed-debt').value = settings.monthlyDebt || '';
    qs('fixed-savings').value = settings.fixedSavings || '';
}

// --- УПРАВЛЕНИЕ ПЕРЕМЕННЫМИ ТРАНЗАКЦИЯМИ ---

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

// --- УПРАВЛЕНИЕ ОБЩИМ ДОЛГОМ ---

export const setInitialTotalDebt = async (amount) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    const debtRef = doc(db, TOTAL_DEBT_COLLECTION, user.uid);
    
    // Получаем текущий статус
    const debtDoc = await getDoc(debtRef);
    const existingDebt = debtDoc.exists() ? debtDoc.data().currentDebt : 0;

    const initialDebtAmount = amount || existingDebt;
    const currentDebtAmount = amount || existingDebt;

    // 1. Устанавливаем статус
    await setDoc(debtRef, {
        userId: user.uid,
        initialDebt: initialDebtAmount,
        currentDebt: currentDebtAmount,
        lastUpdated: Date.now()
    });

    // 2. Логируем начальную точку для графика
    await addDoc(collection(db, REPAYMENT_LOGS_COLLECTION), {
        userId: user.uid,
        amount: currentDebtAmount, // В логах это будет "остаток долга"
        type: 'INITIAL_SET',
        timestamp: Date.now()
    });
};

export const addDebtRepaymentLog = async (repaymentAmount) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    const debtRef = doc(db, TOTAL_DEBT_COLLECTION, user.uid);
    
    const debtDoc = await getDoc(debtRef);
    if (!debtDoc.exists()) {
        alert("Please set the initial total debt first.");
        return;
    }
    
    const currentDebtData = debtDoc.data();
    const newCurrentDebt = Math.max(0, currentDebtData.currentDebt - repaymentAmount);

    // 1. Обновляем статус
    await updateDoc(debtRef, {
        currentDebt: newCurrentDebt,
        lastUpdated: Date.now()
    });

    // 2. Логируем остаток для графика
    await addDoc(collection(db, REPAYMENT_LOGS_COLLECTION), {
        userId: user.uid,
        amount: newCurrentDebt, // В логах сохраняем ОСТАТОК
        repaymentAmount: repaymentAmount, 
        type: 'REPAYMENT',
        timestamp: Date.now()
    });
};

function renderDebtStatus(debtStatus) {
    const container = qs('total-debt-status');
    const format = (value) => `$${(value || 0).toFixed(2)}`;

    if (!debtStatus || debtStatus.initialDebt === undefined) {
        container.innerHTML = `<p class="metric-card" style="color:red; flex: 1 1 100%;">Total Debt not set. Use the form above to initialize it.</p>`;
        return;
    }

    const initial = debtStatus.initialDebt;
    const current = debtStatus.currentDebt;
    const paid = initial - current;
    const percentage = initial > 0 ? (paid / initial) * 100 : 0;

    container.innerHTML = `
        <div class="metric-card">
            <h4>Initial Total Debt</h4>
            <p class="debt-value">${format(initial)}</p>
        </div>
        <div class="metric-card">
            <h4>Remaining Debt</h4>
            <p class="debt-value">${format(current)}</p>
        </div>
        <div class="metric-card">
            <h4>Repaid Progress</h4>
            <p class="saving-value">${percentage.toFixed(1)}% (${format(paid)})</p>
        </div>
    `;
}

// --- ГЛАВНАЯ ФУНКЦИЯ ЗАГРУЗКИ ---

export const loadTransactionsForUser = (startDateStr, endDateStr) => {
    const user = auth.currentUser;
    if (!user) return;
    
    let startTime, endTime;
    if (!startDateStr || !endDateStr) {
        const currentMonthRange = getCurrentMonthRange();
        startTime = currentMonthRange.startTime;
        endTime = currentMonthRange.endTime;
    } else {
        startTime = dateToTimestamp(startDateStr);
        endTime = dateToTimestampEnd(endDateStr);
    }

    const q = query(
        collection(db, TRANSACTIONS_COLLECTION),
        where("userId", "==", user.uid),
        where("timestamp", ">=", startTime),
        where("timestamp", "<=", endTime),
        orderBy("timestamp", "asc")
    );
    
    const settingsRef = doc(db, SETTINGS_COLLECTION, user.uid);
    onSnapshot(settingsRef, (docSnap) => {
        let settings = docSnap.exists() 
            ? docSnap.data() 
            : { monthlySalary: 0, monthlyDebt: 0, fixedSavings: 0 };
        renderFixedSettings(settings);

        onSnapshot(q, (snapshot) => {
            const variableData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderFinancialMetrics(variableData, settings);
            renderCharts(variableData, settings); 
            renderTransactionHistory(variableData);
        });
    });

    // Подписка на статус общего долга
    const debtRef = doc(db, TOTAL_DEBT_COLLECTION, user.uid);
    onSnapshot(debtRef, (docSnap) => {
        const debtStatus = docSnap.exists() ? docSnap.data() : null;
        renderDebtStatus(debtStatus);
        subscribeToRepaymentLogs(user.uid, debtStatus); 
    });
};

function renderFinancialMetrics(data, settings) {
    const metricsContainer = qs('summary-metrics');
    
    const totals = data.reduce((acc, item) => {
        if (item.type === 'Bonus') acc.bonus += item.amount;
        if (item.type === 'Expense') acc.expense += item.amount;
        return acc;
    }, { bonus: 0, expense: 0 });

    const fixedSalary = settings.monthlySalary || 0;
    const fixedDebt = settings.monthlyDebt || 0;
    const fixedSavings = settings.fixedSavings || 0; 
    
    const totalObligations = fixedDebt + fixedSavings + totals.expense;
    const totalIncome = fixedSalary + totals.bonus;
    
    const netFlow = totalIncome - totalObligations;
    
    const format = (value) => `$${(value).toFixed(2)}`;
    
    metricsContainer.innerHTML = `
        <div class="metric-card">
            <h4>Total Income (Fixed + Bonus)</h4>
            <p class="saving-value">${format(totalIncome)}</p>
        </div>
        <div class="metric-card">
            <h4>Total Obligations (Debt + Savings + Expense)</h4>
            <p class="debt-value">${format(totalObligations)}</p>
        </div>
        <div class="metric-card">
            <h4>Net Flow (Income - Obligations)</h4>
            <p class="${netFlow >= 0 ? 'saving-value' : 'debt-value'}">${format(netFlow)}</p>
        </div>
        <div class="metric-card">
            <h4>Variable Net Flow (Bonus - Expense)</h4>
            <p class="${(totals.bonus - totals.expense) >= 0 ? 'saving-value' : 'debt-value'}">${format(totals.bonus - totals.expense)}</p>
        </div>
    `;
}

// --- УПРАВЛЕНИЕ ГРАФИКАМИ ---

function renderCharts(variableData, settings) {
    renderChartFixedObligations(settings); 
    renderChartFixedBreakdown(settings);   
    renderChartTotalFlow(variableData, settings); 
    renderChartVariableBreakdown(variableData);
}

// 1. Salary vs Debt (Doughnut)
function renderChartFixedObligations(settings) {
    const salary = settings.monthlySalary || 0;
    const debt = settings.monthlyDebt || 0;
    if (charts.fixedObligations) charts.fixedObligations.destroy();
    charts.fixedObligations = new Chart(qs('chartFixedObligations'), {
        type: 'doughnut', 
        data: {
            labels: ['Monthly Salary', 'Monthly Debt'],
            datasets: [{
                data: [salary, debt],
                backgroundColor: ['#2ecc71', '#e74c3c'], 
                hoverOffset: 4
            }]
        },
        options: { responsive: true, plugins: { title: { display: true, text: 'Fixed: Salary vs Debt' } } }
    });
}
// 2. Salary vs Debt vs Savings (Doughnut)
function renderChartFixedBreakdown(settings) {
    const salary = settings.monthlySalary || 0;
    const debt = settings.monthlyDebt || 0;
    const savings = settings.fixedSavings || 0;
    if (charts.fixedBreakdown) charts.fixedBreakdown.destroy();
    charts.fixedBreakdown = new Chart(qs('chartFixedBreakdown'), {
        type: 'doughnut', 
        data: {
            labels: ['Salary', 'Debt', 'Savings'],
            datasets: [{
                data: [salary, debt, savings],
                backgroundColor: ['#2ecc71', '#e74c3c', '#3498db'], 
                hoverOffset: 4
            }]
        },
        options: { responsive: true, plugins: { title: { display: true, text: 'Fixed Monthly Breakdown' } } }
    });
}
// 3. Total Income vs Total Obligations (Doughnut)
function renderChartTotalFlow(data, settings) {
    const fixedSalary = settings.monthlySalary || 0;
    const fixedDebt = settings.monthlyDebt || 0;
    const fixedSavings = settings.fixedSavings || 0;
    const totalBonus = data.filter(d => d.type === 'Bonus').reduce((sum, d) => sum + d.amount, 0);
    const totalExpenseVariable = data.filter(d => d.type === 'Expense').reduce((sum, d) => sum + d.amount, 0);
    const totalIncome = fixedSalary + totalBonus;
    const totalObligations = fixedDebt + fixedSavings + totalExpenseVariable;
    if (charts.totalFlow) charts.totalFlow.destroy();
    charts.totalFlow = new Chart(qs('chartTotalFlow'), {
        type: 'doughnut', 
        data: {
            labels: ['Total Income', 'Total Obligations'],
            datasets: [{
                data: [totalIncome, totalObligations],
                backgroundColor: ['#1abc9c', '#e74c3c'], 
                hoverOffset: 4
            }]
        },
        options: { responsive: true, plugins: { title: { display: true, text: 'Total Flow (Income vs Obligations)' } } }
    });
}
// 4. Bonus vs Variable Expenses (Doughnut)
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
                backgroundColor: ['#f39c12', '#27ae60'], 
                hoverOffset: 4
            }]
        },
        options: { responsive: true, plugins: { title: { display: true, text: 'Variable: Bonus vs Expense' } } }
    });
}

// 5. Debt Repayment Progress (Line Chart)
function subscribeToRepaymentLogs(userId, debtStatus) {
    if (!debtStatus || debtStatus.initialDebt === undefined) {
        if (charts.debtTracker) charts.debtTracker.destroy();
        return;
    }
    
    const q = query(
        collection(db, REPAYMENT_LOGS_COLLECTION),
        where("userId", "==", userId),
        orderBy("timestamp", "asc")
    );
    
    onSnapshot(q, (snapshot) => {
        const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderDebtTrackerChart(logs, debtStatus.initialDebt);
    });
}

function renderDebtTrackerChart(logs, initialDebt) {
    if (!logs || logs.length === 0) {
        if (charts.debtTracker) charts.debtTracker.destroy();
        return;
    }
    
    const labels = logs.map(log => {
        const date = new Date(log.timestamp);
        return date.toLocaleDateString();
    });
    
    const data = logs.map(log => log.amount); // Это остаток долга

    if (charts.debtTracker) charts.debtTracker.destroy();
    
    charts.debtTracker = new Chart(qs('chartDebtTracker'), {
        type: 'line', 
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Remaining Debt (AMD)',
                    data: data,
                    borderColor: '#f1c40f', 
                    tension: 0.3, 
                    fill: false,
                    pointRadius: 4,
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    min: 0,
                    max: initialDebt * 1.05, 
                    reverse: false, 
                    title: {
                        display: true,
                        text: 'Remaining Debt (AMD)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Date of Repayment Log'
                    }
                }
            },
            plugins: { title: { display: true, text: `Total Debt: $${initialDebt.toFixed(2)}` } }
        }
    });
}

// --- CRUD и История Транзакций ---

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

        const editFunc = `window.editTransaction('${item.id}', '${item.type}', ${item.amount}, \`${item.description.replace(/'/g, "\\'")}\`)`;

        li.innerHTML = `
            <div class="transaction-info">
                <span class="type">${item.type}</span>
                <span class="description">${item.description}</span>
                <span class="amount">${formattedAmount}</span>
                <span class="date">${date}</span>
            </div>
            <div class="transaction-actions">
                <button onclick="${editFunc}" title="Edit">✏️</button>
                <button onclick="window.deleteTransaction('${item.id}')" title="Delete">🗑️</button>
            </div>
        `;
        historyList.appendChild(li);
    });
}

export const deleteTransaction = async (id) => {
    if (confirm("Are you sure you want to delete this financial record?")) {
        await deleteDoc(doc(db, TRANSACTIONS_COLLECTION, id));
    }
}
export async function updateTransaction(id, amount, description) {
    const transactionRef = doc(db, TRANSACTIONS_COLLECTION, id);
    await updateDoc(transactionRef, { amount: amount, description: description });
}


// --- ВАЛИДАЦИЯ И ИНИЦИАЛИЗАЦИЯ ---

function addInputValidation() {
    ['fixed-salary', 'fixed-debt', 'fixed-savings', 'amount-input', 'initial-debt-amount', 'repayment-amount'].forEach(id => {
        const input = qs(id);
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (!/[0-9.,]/.test(e.key)) e.preventDefault();
            });
            input.addEventListener('change', () => {
                let value = input.value.replace(',', '.');
                value = value.replace(/[^\d.]/g, ''); 
                const parts = value.split('.');
                if (parts.length > 2) value = parts[0] + '.' + parts.slice(1).join('');
                input.value = value;
            });
        }
    });
}
export const initFinanceController = () => {
    auth.onAuthStateChanged(user => {
        if (user) {
            const { startTime, endTime } = getCurrentMonthRange();
            const startDate = new Date(startTime);
            const endDate = new Date(endTime);
            qs('start-date').value = formatDate(startDate);
            endDate.setDate(endDate.getDate() - 1); 
            qs('end-date').value = formatDate(endDate);
            
            loadTransactionsForUser(qs('start-date').value, qs('end-date').value); 
            
            addInputValidation();
        }
    });
};