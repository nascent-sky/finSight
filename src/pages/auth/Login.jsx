import { auth, provider, db } from "../../firebase"
import { doc, setDoc } from "firebase/firestore"
import { Link, useNavigate } from "react-router-dom"
import { useEffect } from "react"
import { signInWithPopup, onAuthStateChanged } from "firebase/auth"
import { FcGoogle } from "react-icons/fc"
import Card from "../../components/ui/Card"
import Button from "../../components/ui/Button"

const Login = () => {
  const navigate = useNavigate()

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        navigate("/")
      }
    })

    return () => unsubscribe()
  }, [navigate])

  const handleGoogleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, provider)
      const user = result.user

      // ✅ Save user in Firestore
      await setDoc(
        doc(db, "users", user.uid),
        {
          name: user.displayName,
          email: user.email,
          photo: user.photoURL,
          createdAt: new Date()
        },
        { merge: true }
      )

      navigate("/")
    } catch (error) {
      console.error("Google Login Error:", error)
    }
  }

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

        {/* Google Button */}
        <Button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-3"
        >
          <FcGoogle size={20} />
          Continue with Google
        </Button>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Don’t have an account?{" "}
          <span className="font-medium text-indigo-600">
            Sign in with Google
          </span>
        </p>
      </Card>
    </div>
  )
}

export default Login