import { Route, Routes } from 'react-router-dom'
import './App.css'
import TripList from './pages/TripList'
import Login from './pages/Login'
import RequireAuth from './components/RequireAuth'
import ShareView from './pages/ShareView'
import ItineraryEditor from './pages/ItineraryEditor'

function App() {
  return (
    <Routes>
      {/* Public: no login needed. */}
      <Route path="/login" element={<Login />} />
      <Route path="/share/:token" element={<ShareView />} />
      {/* Everything else needs a login. */}
      <Route path="/" element={<RequireAuth><TripList /></RequireAuth>} />
      <Route path="/trips/:tripId" element={<RequireAuth><ItineraryEditor /></RequireAuth>} />
    </Routes>
  )
}

export default App
