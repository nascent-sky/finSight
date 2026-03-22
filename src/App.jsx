import { Outlet } from "react-router-dom"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { useState, useEffect } from "react"

import Sidebar from "./components/layout/Sidebar"
import Header from "./components/layout/Header"
import BottomNav from "./components/layout/BottomNav"
import QuickAddExpenseModal from "./components/common/QuickAddExpenseModal"
import ExpenseWidget from "./components/common/ExpenseWidget"

// Pages
import Login from "./pages/auth/Login"
import Register from "./pages/auth/Register"
import Dashboard from "./pages/Dashboard"
import Expenses from "./pages/Expenses"
import Analytics from "./pages/Analytics"
import Categories from "./pages/Categories"
import AddExpense from "./pages/AddExpense"
import Settings from "./pages/Settings"

// Layout wrapper for authenticated pages
const AuthLayout = ({ children, isSidebarOpen, setIsSidebarOpen, onAddClick, isQuickAddOpen, setIsQuickAddOpen, onExpenseAdded }) => (
  <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
    <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
    <div className="flex flex-1 flex-col">
      <Header
        title="FinSight"
        onMenuClick={() => setIsSidebarOpen(true)}
        onAddClick={onAddClick}
      />
      <main className="flex-1 p-4 pb-20 md:pb-4 overflow-y-auto">
        <Outlet />
      </main>
      <BottomNav onAddClick={onAddClick} />
    </div>
    <ExpenseWidget />
    <QuickAddExpenseModal
      isOpen={isQuickAddOpen}
      onClose={() => setIsQuickAddOpen(false)}
      onExpenseAdded={onExpenseAdded}
    />
  </div>
)

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false)

  const handleQuickAddExpense = () => {
    setIsQuickAddOpen(true)
  }

  const handleExpenseAdded = (expense) => {
    window.dispatchEvent(new CustomEvent('expenseAdded', { detail: { expense } }))
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Auth Routes (NO layout) */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* App Routes (WITH layout) */}
        {/* <Route path="/" element={
          <AuthLayout
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            onAddClick={handleQuickAddExpense}
            isQuickAddOpen={isQuickAddOpen}
            setIsQuickAddOpen={setIsQuickAddOpen}
            onExpenseAdded={handleExpenseAdded}
          >
            <Dashboard />
          </AuthLayout>
        } />
        <Route path="/expenses" element={
          <AuthLayout
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            onAddClick={handleQuickAddExpense}
            isQuickAddOpen={isQuickAddOpen}
            setIsQuickAddOpen={setIsQuickAddOpen}
            onExpenseAdded={handleExpenseAdded}
          >
            <Expenses />
          </AuthLayout>
        } />
        <Route path="/analytics" element={
          <AuthLayout
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            onAddClick={handleQuickAddExpense}
            isQuickAddOpen={isQuickAddOpen}
            setIsQuickAddOpen={setIsQuickAddOpen}
            onExpenseAdded={handleExpenseAdded}
          >
            <Analytics />
          </AuthLayout>
        } />
        <Route path="/categories" element={
          <AuthLayout
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            onAddClick={handleQuickAddExpense}
            isQuickAddOpen={isQuickAddOpen}
            setIsQuickAddOpen={setIsQuickAddOpen}
            onExpenseAdded={handleExpenseAdded}
          >
            <Categories />
          </AuthLayout>
        } />
        <Route path="/add-expense" element={
          <AuthLayout
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            onAddClick={handleQuickAddExpense}
            isQuickAddOpen={isQuickAddOpen}
            setIsQuickAddOpen={setIsQuickAddOpen}
            onExpenseAdded={handleExpenseAdded}
          >
            <AddExpense />
          </AuthLayout>
        } />
        <Route path="/settings" element={
          <AuthLayout
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            onAddClick={handleQuickAddExpense}
            isQuickAddOpen={isQuickAddOpen}
            setIsQuickAddOpen={setIsQuickAddOpen}
            onExpenseAdded={handleExpenseAdded}
          >
            <Settings />
          </AuthLayout>
        } /> */}
        <Route
          path="/"
          element={
            <AuthLayout
              isSidebarOpen={isSidebarOpen}
              setIsSidebarOpen={setIsSidebarOpen}
              onAddClick={handleQuickAddExpense}
              isQuickAddOpen={isQuickAddOpen}
              setIsQuickAddOpen={setIsQuickAddOpen}
              onExpenseAdded={handleExpenseAdded}
            />
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="categories" element={<Categories />} />
          <Route path="add-expense" element={<AddExpense />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
