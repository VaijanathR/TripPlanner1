import { Route, Routes } from 'react-router-dom'
import './App.css'
import TripList from './pages/TripList'
import ItineraryEditor from './pages/ItineraryEditor'

function App() {
  return (
    <Routes>
      <Route path="/" element={<TripList />} />
      <Route path="/trips/:tripId" element={<ItineraryEditor />} />
    </Routes>
  )
}

export default App
