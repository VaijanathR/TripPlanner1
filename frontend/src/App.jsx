import { Route, Routes } from 'react-router-dom'
import './App.css'
import TripList from './pages/TripList'
import Login from './pages/Login'
import RequireAuth from './components/RequireAuth'
import ShareView from './pages/ShareView'
import ItineraryEditor from './pages/ItineraryEditor'
import Credits from './pages/Credits'
import Account from './pages/Account'
import Admin from './pages/Admin'
import SiteFooter from './components/SiteFooter'

function App() {
  return (
    <>
    <Routes>
      {/* Public: no login needed. */}
      <Route path="/login" element={<Login />} />
      <Route path="/share/:token" element={<ShareView />} />
      <Route path="/credits" element={<Credits />} />
      {/* Everything else needs a login. */}
      <Route path="/" element={<RequireAuth><TripList /></RequireAuth>} />
      <Route path="/trips/:tripId" element={<RequireAuth><ItineraryEditor /></RequireAuth>} />
      <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
    </Routes>
    <SiteFooter />
    </>
  )
}

export default App
