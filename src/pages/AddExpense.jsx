import { useState } from "react"
import { Mic, MicOff } from "lucide-react"
import Card from "../components/ui/Card"
import Input from "../components/ui/Input"
import Button from "../components/ui/Button"


const categories = [
  "Food",
  "Transport",
  "Shopping",
  "Bills",
  "Entertainment",
  "Health",
]

const AddExpense = () => {

  const [isListening, setIsListening] = useState(false)
  
  return (
    <div className="relative space-y-6 pb-24">
      
      {/* Page Title */}
      <div>
        <h1 className="text-xl font-semibold">Add Expense</h1>
        <p className="text-sm text-gray-500">
          Record your spending easily
        </p>
      </div>

      {/* Amount Input */}
      <Card>
        <div className="text-center">
          <p className="mb-2 text-sm text-gray-500">Amount</p>
          <input
            type="number"
            placeholder="₹0"
            className="w-full border-none bg-transparent text-center text-4xl font-semibold focus:outline-none"
          />
        </div>
      </Card>

      {/* Category Selection */}
      <Card>
        <p className="mb-3 text-sm font-medium">Category</p>

        <div className="grid grid-cols-3 gap-3">
          {categories.map((category) => (
            <button
              key={category}
              className="rounded-lg border border-gray-200 py-3 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {category}
            </button>
          ))}
        </div>
      </Card>

      {/* Other Inputs */}
      <Card>
        <div className="space-y-4">
          <Input
            label="Note"
            placeholder="e.g. Lunch with friends"
          />

          <Input
            label="Date"
            type="date"
          />
        </div>
      </Card>

      {/* Voice Input */}
      <Card>
  <div className="flex items-center justify-between">
    <div>
      <p className="font-medium">Voice input</p>
      <p className="text-sm text-gray-500">
        {isListening ? "Listening..." : "Tap to add expense using voice"}
      </p>
    </div>

    <button
      onClick={() => setIsListening(!isListening)}
      className={`rounded-full p-3 text-white transition ${
        isListening ? "bg-red-500 animate-pulse" : "bg-indigo-600"
      }`}
    >
      {isListening ? <MicOff size={20} /> : <Mic size={20} />}
    </button>
  </div>
</Card>


      {/* Bottom Save Button */}
      <div className="fixed bottom-16 left-0 right-0 z-40 px-4 md:static md:px-0">
        <Button className="w-full py-3 text-base">
          Save Expense
        </Button>
      </div>

    </div>
  )
}

export default AddExpense
