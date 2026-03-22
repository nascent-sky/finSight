import { Link } from "react-router-dom"
import Button from "../../components/ui/Button"
import Input from "../../components/ui/Input"
import Card from "../../components/ui/Card"

const Login = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      
      <Card className="w-full max-w-md">
        {/* Title */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Sign in to continue to FinSight
          </p>
        </div>

        {/* Form */}
        <form className="space-y-4">
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
          />

          {/* Forgot password */}
          <div className="flex justify-end">
            <button
              type="button"
              className="text-sm text-indigo-600 hover:underline"
            >
              Forgot password?
            </button>
          </div>

          {/* Submit */}
          <Button className="w-full">
            Sign In
          </Button>
        </form>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Don’t have an account?{" "}
          <Link
            to="/register"
            className="font-medium text-indigo-600 hover:underline"
          >
            Sign up
          </Link>
        </p>
      </Card>
    </div>
  )
}

export default Login
