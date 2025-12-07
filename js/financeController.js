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

let currentChart = null; // Для хранения экземпляра Chart.js

/**
 * Добавляет финансовую запись в Firestore.
 * @param {string} type Тип записи (salary, savings, credit_debt, monthly_payment).
 * @param {number} amount Сумма.
 */
export const addFinanceData = async (type, amount) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");

    await addDoc(collection(db, FINANCE_COLLECTION), {
        userId: user.uid,
        type: type,
        amount: amount,
        timestamp: Date.now()
    });
};

/**
 * Инициализирует контроллер: загружает данные и подписывается на обновления.
 */
export const initFinanceController = () => {
    auth.onAuthStateChanged(user => {
        if (user) {
            loadFinancialData(user.uid);
        }
    });
};

/**
 * Загружает данные из Firestore и вызывает функции отрисовки.
 * @param {string} userId ID пользователя.
 */
function loadFinancialData(userId) {
    const q = query(
        collection(db, FINANCE_COLLECTION),
        where("userId", "==", userId),
        orderBy("timestamp", "desc")
    );

    onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Передаем данные для отрисовки
        renderFinancialSummary(data);
        renderDebtList(data);
        renderStatisticsChart(data);
    });
}

/**
 * Рендерит список долгов (кредитов) и ежемесячных выплат.
 */
function renderDebtList(data) {
    const debtList = qs('debt-list');
    debtList.innerHTML = '';
    
    // Фильтруем и суммируем только долги и ежемесячные платежи
    const debts = data.filter(d => d.type === 'credit_debt' || d.type === 'monthly_payment');

    if (debts.length === 0) {
        debtList.innerHTML = '<li>No debts recorded.</li>';
        return;
    }

    debts.forEach(item => {
        const li = document.createElement('li');
        const formattedAmount = `$${item.amount.toFixed(2)}`;
        
        let label = '';
        if (item.type === 'credit_debt') {
            label = `Credit Debt Remaining: ${formattedAmount}`;
        } else if (item.type === 'monthly_payment') {
            label = `Monthly Payment: ${formattedAmount}`;
        }

        li.innerHTML = `
            <span>${label} (${new Date(item.timestamp).toLocaleDateString()})</span>
            <button onclick="deleteFinanceItem('${item.id}')">X</button>
        `;
        debtList.appendChild(li);
    });
}

/**
 * Рендерит суммарные метрики.
 */
function renderFinancialSummary(data) {
    const metricsContainer = qs('summary-metrics');
    
    // Суммирование данных
    const totals = data.reduce((acc, item) => {
        if (item.type === 'salary') acc.salary += item.amount;
        if (item.type === 'savings') acc.savings += item.amount;
        if (item.type === 'credit_debt') acc.debt += item.amount;
        return acc;
    }, { salary: 0, savings: 0, debt: 0 });

    const netWorth = totals.savings - totals.debt;
    
    // Форматирование
    const format = (value) => `$${value.toFixed(2)}`;
    
    // HTML для метрик
    metricsContainer.innerHTML = `
        <div class="metric-card">
            <h4>Total Savings</h4>
            <p class="saving-value">${format(totals.savings)}</p>
        </div>
        <div class="metric-card">
            <h4>Total Debt</h4>
            <p class="debt-value">${format(totals.debt)}</p>
        </div>
        <div class="metric-card">
            <h4>Net Worth</h4>
            <p class="${netWorth >= 0 ? 'saving-value' : 'debt-value'}">${format(netWorth)}</p>
        </div>
    `;
}

/**
 * Рендерит график.
 */
function renderStatisticsChart(data) {
    const ctx = qs('financeChart');
    if (!ctx) return;

    // Подсчет суммы по категориям (для круговой диаграммы)
    const categoryTotals = data.reduce((acc, item) => {
        // Мы хотим показать распределение долгов, сбережений и оставшегося дохода
        if (item.type === 'savings') acc.savings += item.amount;
        if (item.type === 'credit_debt') acc.debt += item.amount;
        return acc;
    }, { savings: 0, debt: 0 });

    const labels = ['Savings', 'Debt'];
    const amounts = [categoryTotals.savings, categoryTotals.debt];

    // Уничтожаем старый график
    if (currentChart) {
        currentChart.destroy();
    }
    
    // Создаем новый график
    currentChart = new Chart(ctx, {
        type: 'doughnut', // Кольцевая диаграмма
        data: {
            labels: labels,
            datasets: [{
                data: amounts,
                backgroundColor: [
                    '#2ecc71', // Savings
                    '#e74c3c'  // Debt
                ],
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            aspectRatio: 1, // Сохраняем квадратную форму
            plugins: {
                legend: {
                    position: 'top',
                },
                title: {
                    display: true,
                    text: 'Savings vs Debt Breakdown'
                }
            }
        }
    });
}

/**
 * Функция удаления элемента (должна быть доступна глобально для onclick в HTML).
 */
window.deleteFinanceItem = async (id) => {
    if (confirm("Are you sure you want to delete this financial record?")) {
        await deleteDoc(doc(db, FINANCE_COLLECTION, id));
    }
}