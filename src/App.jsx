import { useEffect, useState } from "react"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { onAuthStateChanged } from "firebase/auth"

import Sidebar from "./components/layout/Sidebar"
import Header from "./components/layout/Header"
import BottomNav from "./components/layout/BottomNav"
import QuickAddExpenseModal from "./components/common/QuickAddExpenseModal"
import ExpenseWidget from "./components/common/ExpenseWidget"
import { auth } from "./firebase"

import Login from "./pages/auth/Login"
import Register from "./pages/auth/Register"
import Dashboard from "./pages/Dashboard"
import Expenses from "./pages/Expenses"
import Analytics from "./pages/Analytics"
import Categories from "./pages/Categories"
import AddExpense from "./pages/AddExpense"
import Settings from "./pages/Settings"

const AuthLayout = ({
  children,
  user,
  isSidebarOpen,
  setIsSidebarOpen,
  onAddClick,
  isQuickAddOpen,
  setIsQuickAddOpen,
}) => (
  <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
    <Sidebar
      isOpen={isSidebarOpen}
      onClose={() => setIsSidebarOpen(false)}
      user={user}
    />
    <div className="flex flex-1 flex-col md:ml-64">
      <Header
        title="FinSight"
        onMenuClick={() => setIsSidebarOpen(true)}
        onAddClick={onAddClick}
      />
      <main className="flex-1 overflow-y-auto p-4 pb-20 md:pb-4">
        {children}
      </main>
      <BottomNav onAddClick={onAddClick} />
    </div>
    <ExpenseWidget />
    <QuickAddExpenseModal
      isOpen={isQuickAddOpen}
      onClose={() => setIsQuickAddOpen(false)}
    />
  </div>
)

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false)
  const [user, setUser] = useState(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
    })

    return () => unsubscribe()
  }, [])

  const handleQuickAddExpense = () => {
    setIsQuickAddOpen(true)
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route
          path="/"
          element={
            <AuthLayout
              user={user}
              isSidebarOpen={isSidebarOpen}
              setIsSidebarOpen={setIsSidebarOpen}
              onAddClick={handleQuickAddExpense}
              isQuickAddOpen={isQuickAddOpen}
              setIsQuickAddOpen={setIsQuickAddOpen}
            >
              <Dashboard />
            </AuthLayout>
          }
        />
        <Route
          path="/expenses"
          element={
            <AuthLayout
              user={user}
              isSidebarOpen={isSidebarOpen}
              setIsSidebarOpen={setIsSidebarOpen}
              onAddClick={handleQuickAddExpense}
              isQuickAddOpen={isQuickAddOpen}
              setIsQuickAddOpen={setIsQuickAddOpen}
            >
              <Expenses />
            </AuthLayout>
          }
        />
        <Route
          path="/analytics"
          element={
            <AuthLayout
              user={user}
              isSidebarOpen={isSidebarOpen}
              setIsSidebarOpen={setIsSidebarOpen}
              onAddClick={handleQuickAddExpense}
              isQuickAddOpen={isQuickAddOpen}
              setIsQuickAddOpen={setIsQuickAddOpen}
            >
              <Analytics />
            </AuthLayout>
          }
        />
        <Route
          path="/categories"
          element={
            <AuthLayout
              user={user}
              isSidebarOpen={isSidebarOpen}
              setIsSidebarOpen={setIsSidebarOpen}
              onAddClick={handleQuickAddExpense}
              isQuickAddOpen={isQuickAddOpen}
              setIsQuickAddOpen={setIsQuickAddOpen}
            >
              <Categories />
            </AuthLayout>
          }
        />
        <Route
          path="/add-expense"
          element={
            <AuthLayout
              user={user}
              isSidebarOpen={isSidebarOpen}
              setIsSidebarOpen={setIsSidebarOpen}
              onAddClick={handleQuickAddExpense}
              isQuickAddOpen={isQuickAddOpen}
              setIsQuickAddOpen={setIsQuickAddOpen}
            >
              <AddExpense />
            </AuthLayout>
          }
        />
        <Route
          path="/settings"
          element={
            <AuthLayout
              user={user}
              isSidebarOpen={isSidebarOpen}
              setIsSidebarOpen={setIsSidebarOpen}
              onAddClick={handleQuickAddExpense}
              isQuickAddOpen={isQuickAddOpen}
              setIsQuickAddOpen={setIsQuickAddOpen}
            >
              <Settings />
            </AuthLayout>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
