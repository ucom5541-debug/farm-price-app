import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import './App.css'

const API_URL = 'http://localhost:3001/api/simumuang'

const CROPS = {
  shallot: {
    title: 'หอมแบ่ง',
    icon: '🧅',
    keywords: ['หอมแบ่ง', 'ต้นหอม', 'หอมต้น'],
  },
  kale: {
    title: 'คะน้า',
    icon: '🥬',
    keywords: ['คะน้า'],
  },
  pakchoi: {
    title: 'กวางตุ้ง',
    icon: '🌿',
    keywords: ['กวางตุ้ง'],
  },
  chili: {
    title: 'พริก',
    icon: '🌶️',
    keywords: ['พริก'],
  },
  coriander: {
  title: "ผักชี",
  icon: "🌿",
  keywords: ["ผักชี"],
},
cucumber: {
  title: "แตงกวา",
  icon: "🥒",
  keywords: ["แตงกวา", "แตงกวาอ่อน"],
},

longbean: {
  title: "ถั่วฝักยาว",
  icon: "🫘",
  keywords: ["ถั่วฝักยาว"],
},

celery: {
  title: "ขึ้นฉ่าย",
  icon: "🌱",
  keywords: ["ขึ้นฉ่าย", "คึ่นช่าย", "คื่นฉ่าย"],
},

morningglory: {
  title: "ผักบุ้งจีน",
  icon: "🌿",
  keywords: ["ผักบุ้งจีน", "ผักบุ้ง"],
},

cabbage: {
  title: "กะหล่ำปลี",
  icon: "🥬",
  keywords: ["กะหล่ำปลี"],
},

}

function getThaiName(item) {
  return (
    item?.th?.name ||
    item?.name?.th ||
    item?.name ||
    'ไม่ทราบชื่อสินค้า'
  )
}

function getPrice(item) {
  const price = item?.price

  if (price == null) return '-'

  if (typeof price === 'number' || typeof price === 'string') {
    return price
  }

  if (typeof price === 'object') {
    const values = [
      price.min,
      price.medium,
      price.max,
      price.small,
      price.large,
    ]
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0)

    if (values.length === 0) return '-'

    const min = Math.min(...values)
    const max = Math.max(...values)

    return min === max ? `${min}` : `${min} - ${max}`
  }

  return '-'
}

function App() {
  const [page, setPage] = useState('home')
  const [selectedCrop, setSelectedCrop] = useState(null)

  const [serverStatus, setServerStatus] =
    useState('กำลังเชื่อมต่อ...')

  const [simumuangData, setSimumuangData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [history, setHistory] = useState([])
  const [chartDays, setChartDays] = useState(7)
 const filteredHistory = useMemo(() => {
  const cutoffDate = new Date()

  cutoffDate.setDate(cutoffDate.getDate() - chartDays + 1)
  cutoffDate.setHours(0, 0, 0, 0)

  const recentHistory = history.filter(
    (item) => new Date(item.timestamp) >= cutoffDate
  )

  const latestByDay = new Map()

  recentHistory.forEach((item) => {
    const date = new Date(item.timestamp)

    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

    const oldItem = latestByDay.get(dayKey)

    if (
      !oldItem ||
      new Date(item.timestamp) > new Date(oldItem.timestamp)
    ) {
      latestByDay.set(dayKey, item)
    }
  })

  return Array.from(latestByDay.values()).sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  )
}, [history, chartDays])
const highestPrice =
  filteredHistory.length > 0
    ? Math.max(...filteredHistory.map((item) => item.averagePrice))
    : 0

    const lowestPrice =
  filteredHistory.length > 0
    ? Math.min(...filteredHistory.map((item) => item.averagePrice))
    : 0

    const averagePeriodPrice =
  filteredHistory.length > 0
    ? 
        filteredHistory.reduce(
          (sum, item) => sum + item.averagePrice,
          0
        ) / filteredHistory.length
      
    : 0

  async function loadPriceHistory(cropKey) {
  try {
    const response = await fetch(
      `http://localhost:3001/api/history?crop=${cropKey}`
    )

    if (!response.ok) {
      throw new Error(`History Server ${response.status}`)
    }

    const result = await response.json()
    setHistory((result.data || []).filter((item) => item.sourceCount === 2))
  } catch (err) {
    console.error("โหลดราคาย้อนหลังไม่สำเร็จ:", err)
    setHistory([])
  }
}
  async function loadMarketData() {
    try {
      setLoading(true)
      setError('')

      const response = await fetch(API_URL)

      if (!response.ok) {
        throw new Error(`Server ตอบกลับ ${response.status}`)
      }

      const data = await response.json()
      console.log("DASHBOARD API DATA:", data)

      setSimumuangData(data)
      setServerStatus('เชื่อมต่อสำเร็จ')
    } catch (err) {
      console.error(err)

      setServerStatus('เชื่อมต่อ Server ไม่สำเร็จ')
      setError(err.message || 'ดึงข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMarketData()
  }, [])

useEffect(() => {
  if (selectedCrop) {
    loadPriceHistory(selectedCrop)
  } else {
    setHistory([])
  }
}, [selectedCrop])

  const simumuangItems = useMemo(() => {
    return simumuangData?.data?.data || []
  }, [simumuangData])

  function findCropItems(cropKey) {
    const crop = CROPS[cropKey]

    if (!crop) return []

    return simumuangItems.filter((item) => {
      const name = getThaiName(item)

      return crop.keywords.some((keyword) =>
        name.includes(keyword)
      )
    })
  }

  function openCrop(cropKey) {
    setSelectedCrop(cropKey)
    setPage('crop')
  }

  if (page === 'crop' && selectedCrop) {
    const crop = CROPS[selectedCrop]
    const items = findCropItems(selectedCrop)

    return (
      <div className="app">
        <header className="header">
          <h1>
            {crop.icon} {crop.title}
          </h1>
          <p>ราคากลางจากหลายตลาด</p>
        </header>

        <main className="dashboard">
          <button
            className="back-button"
            onClick={() => setPage('prices')}
          >
            ← กลับหน้าราคาพืชผัก
          </button>

          <div className="menu-card">
            <h3>🏪 ตลาดสี่มุมเมือง</h3>

            <p>
              สถานะ:{' '}
              <strong>{serverStatus}</strong>
            </p>

            {loading && <h2>กำลังโหลดราคา...</h2>}

            {error && (
              <>
                <h2>ดึงข้อมูลไม่สำเร็จ</h2>
                <p>{error}</p>
              </>
            )}

            {!loading && !error && items.length === 0 && (
              <>
                <h2>ยังไม่พบสินค้า</h2>
                <p>
                  ไม่พบชื่อ {crop.title} ในข้อมูลล่าสุด
                </p>
              </>
            )}
          </div>

          {!loading &&
            !error &&
            items.map((item, index) => (
              <div
                className="menu-card"
                key={item?._id || index}
              >
                <h3>{getThaiName(item)}</h3>                
<p>ราคากลางหลายตลาด</p>

<h2>
  {item.averagePrice ?? getPrice(item)}
</h2>

<p>บาท / กก.</p>

<p>
  ใช้ข้อมูล {item.sourceCount ?? 0} ตลาด
</p>
<div className="market-list">
  {Array.isArray(item.markets) &&
    item.markets
      .filter((market) => market.available)
      .map((market, index) => (
        <p key={`${market.market}-${index}`}>
          {market.market}:{" "}
          {market.min === market.max
            ? market.min
            : `${market.min} - ${market.max}`}{" "}
          บาท/กก.
        </p>
      ))}
</div>
              </div>
            ))}

          <div className="menu-card">
            <h3>🔄 อัปเดตข้อมูล</h3>

            <button
              className="back-button"
              onClick={loadMarketData}
            >
              โหลดราคาล่าสุด
            </button>
          </div>

          <div className="menu-card">
            <h3>📅 ราคาย้อนหลัง</h3>
{history.length === 0 ? (
  <p>ยังไม่มีข้อมูลราคาย้อนหลัง</p>
) : (
  history.map((item, index) => (
    <div key={index}>
      <strong>{item.averagePrice} บาท/กก.</strong>
      <br />
      <small>
        {new Date(item.timestamp).toLocaleString("th-TH")}
      </small>
    </div>
  ))
)}
</div>
          <div className="menu-card">
            <h3>📈 กราฟราคา</h3>

            <p className="highest-price">
  ราคาสูงสุด {highestPrice} บาท/กก.
</p>

<p className="lowest-price">
  ราคาต่ำสุด {lowestPrice} บาท/กก.
</p>

<p className="average-price">
  ราคาเฉลี่ย {Number(averagePeriodPrice.toFixed(2))} บาท/กก.
</p>

            <div className="chart-range-buttons">
              <button
  className={chartDays === 7 ? "active" : ""}
  onClick={() => setChartDays(7)}
  >
    7 วัน
  </button>
<button
  className={chartDays === 30 ? "active" : ""}
  onClick={() => setChartDays(30)}
>
    30 วัน
  </button>
  <button
  className={chartDays === 90 ? "active" : ""}
  onClick={() => setChartDays(90)}
>
  90 วัน
</button>
</div>
            {history.length === 0 ? (
  <p>ยังไม่มีข้อมูลสำหรับกราฟ</p>
) : (
  <div className="line-chart">
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={filteredHistory}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis
      dataKey="timestamp"
      tickFormatter={(value) =>
        new Date(value).toLocaleDateString("th-TH", {
          day: "2-digit",
          month: "2-digit",
        })
      }
    />
    <YAxis domain={["dataMin - 10", "dataMax + 10"]} />
    <Tooltip
      labelFormatter={(value) =>
        new Date(value).toLocaleDateString("th-TH")
      }
      formatter={(value) => [`${value} บาท/กก.`, "ราคาเฉลี่ย"]}
    />
    <Line
      type="monotone"
      dataKey="averagePrice"
      stroke="#4f8f83"
      strokeWidth={3}
      dot={{ r: 5 }}
    />
  </LineChart>
</ResponsiveContainer>
</div>
)}
          </div>
        </main>
      </div>
    )
  }

  if (page === 'prices') {
    return (
      <div className="app">
        <header className="header">
          <h1>💰 ราคาพืชผัก</h1>
          <p>
            ข้อมูลล่าสุดจากตลาดสี่มุมเมือง
          </p>
        </header>

        <main className="dashboard">
          <button
            className="back-button"
            onClick={() => setPage('home')}
          >
            ← กลับหน้าแรก
          </button>

          <div className="menu-card">
            <h3>สถานะระบบตลาด</h3>
            <p>{serverStatus}</p>

            <p>
              พบข้อมูลทั้งหมด{' '}
              <strong>{simumuangItems.length}</strong>{' '}
              รายการ
            </p>
          </div>

          <div className="menu-grid">
            <div
              className="menu-card"
              onClick={() => openCrop('shallot')}
            >
              <span>🧅</span>
              <h3>หอมแบ่ง</h3>
              <p>ดูราคาล่าสุด</p>
            </div>

            <div
              className="menu-card"
              onClick={() => openCrop('kale')}
            >
              <span>🥬</span>
              <h3>คะน้า</h3>
              <p>ดูราคาล่าสุด</p>
            </div>

            <div
              className="menu-card"
              onClick={() => openCrop('pakchoi')}
            >
              <span>🌿</span>
              <h3>กวางตุ้ง</h3>
              <p>ดูราคาล่าสุด</p>
            </div>

            <div
              className="menu-card"
              onClick={() => openCrop('chili')}
            >
              <span>🌶️</span>
              <h3>พริก</h3>
              <p>ดูราคาล่าสุด</p>
            </div>
            <div
  className="menu-card"
  onClick={() => openCrop("coriander")}
>
  <span>🌿</span>
  <h3>ผักชี</h3>
  <p>ดูราคาล่าสุด</p>
</div>

<div
  className="menu-card"
  onClick={() => openCrop("cucumber")}
>
  <span>🥒</span>
  <h3>แตงกวา</h3>
  <p>ดูราคาล่าสุด</p>
</div>

<div
  className="menu-card"
  onClick={() => openCrop("longbean")}
>
  <span>🫘</span>
  <h3>ถั่วฝักยาว</h3>
  <p>ดูราคาล่าสุด</p>
</div>

<div
  className="menu-card"
  onClick={() => openCrop("celery")}
>
  <span>🌱</span>
  <h3>ขึ้นฉ่าย</h3>
  <p>ดูราคาล่าสุด</p>
</div>

<div
  className="menu-card"
  onClick={() => openCrop("morningglory")}
>
  <span>🌿</span>
  <h3>ผักบุ้งจีน</h3>
  <p>ดูราคาล่าสุด</p>
</div>

<div
  className="menu-card"
  onClick={() => openCrop("cabbage")}
>
  <span>🥬</span>
  <h3>กะหล่ำปลี</h3>
  <p>ดูราคาล่าสุด</p>
</div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>📊 Farm Dashboard</h1>
          <p>
            ระบบจัดการฟาร์มและวางแผนการปลูก
          </p>
        </div>
      </header>

      <main className="dashboard">
        <h2>สวัสดีครับ 👋</h2>

        <p className="subtitle">
          เลือกเมนูที่ต้องการใช้งาน
        </p>

        <div className="menu-grid">
          <div
            className="menu-card"
            onClick={() => setPage('prices')}
          >
            <span>💰</span>
            <h3>ราคาพืชผัก</h3>
            <p>
              ติดตามราคาตลาดและแนวโน้มราคา
            </p>
          </div>

          <div className="menu-card">
            <span>🌱</span>
            <h3>แผนการปลูก</h3>
            <p>
              วางแผนวันปลูกและวันเก็บเกี่ยว
            </p>
          </div>

          <div className="menu-card">
            <span>🧑‍🌾</span>
            <h3>แปลงของฉัน</h3>
            <p>
              บันทึกข้อมูลพืชและอายุแปลง
            </p>
          </div>

          <div className="menu-card">
            <span>📈</span>
            <h3>วิเคราะห์กำไร</h3>
            <p>
              คำนวณต้นทุน รายรับ และกำไร
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App