import { Route, Routes } from 'react-router-dom'
import './App.css'
import TripList from './pages/TripList'
import ShareView from './pages/ShareView'
import ItineraryEditor from './pages/ItineraryEditor'

function App() {
  return (
    <Routes>
      <Route path="/" element={<TripList />} />
      <Route path="/trips/:tripId" element={<ItineraryEditor />} />
      <Route path="/share/:token" element={<ShareView />} />
    </Routes>
  )
}

export default App
