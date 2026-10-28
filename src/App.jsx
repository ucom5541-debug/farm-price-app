import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import './App.css'

// ใช้ Backend ในเครื่องระหว่างพัฒนา และใช้ Render เมื่อเปิดเว็บออนไลน์
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV
    ? 'http://localhost:3001'
    : 'https://farm-price-app.onrender.com')
).replace(/\/+$/, '')

const API_URL = `${API_BASE_URL}/api/simumuang`

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

// ราคาในประวัติเก็บเป็น UTC แต่วันที่รายวันอ้างอิงเวลาไทย (UTC+7)
const DAY_MS = 24 * 60 * 60 * 1000
const THAILAND_OFFSET_MS = 7 * 60 * 60 * 1000

function bangkokDayKey(timestamp) {
  const parsed = new Date(timestamp)
  if (!Number.isFinite(parsed.getTime())) return null
  return new Date(parsed.getTime() + THAILAND_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
}

function formatDayShort(dayKey) {
  if (!dayKey) return '-'
  return `${dayKey.slice(8, 10)}/${dayKey.slice(5, 7)}`
}

function formatDayFull(dayKey) {
  if (!dayKey) return '-'
  return `${formatDayShort(dayKey)}/${Number(dayKey.slice(0, 4)) + 543}`
}

function historyQuality(item) {
  // เลือกรายการที่ราคาไม่เริ่มต้นจากศูนย์ก่อน และมีอย่างน้อย 2 ตลาด
  return [
    Number(item.minPrice) > 0 ? 1 : 0,
    Number(item.sourceCount) >= 2 ? 1 : 0,
    new Date(item.timestamp).getTime(),
  ]
}

function isPreferredHistory(candidate, existing) {
  const first = historyQuality(candidate)
  const second = historyQuality(existing)
  for (let i = 0; i < first.length; i += 1) {
    if (first[i] !== second[i]) return first[i] > second[i]
  }
  return false
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
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [chartDays, setChartDays] = useState(7)

  // ไม่เปลี่ยนไฟล์ประวัติจริง: เลือกราคาหนึ่งรายการต่อหนึ่งวันเพื่อแสดงผลเท่านั้น
  const dailyHistory = useMemo(() => {
    const latestByDay = new Map()

    history.forEach((item) => {
      const price = Number(item?.averagePrice)
      const dayKey = bangkokDayKey(item?.timestamp)
      if (!dayKey || !Number.isFinite(price) || price <= 0) return
      if (selectedCrop && item?.crop !== selectedCrop) return

      const candidate = { ...item, averagePrice: price, dayKey }
      const oldItem = latestByDay.get(dayKey)
      if (!oldItem || isPreferredHistory(candidate, oldItem)) {
        latestByDay.set(dayKey, candidate)
      }
    })

    return latestByDay
  }, [history, selectedCrop])

  // สร้างวันที่ครบตามช่วง 7/30/90 วัน โดยใช้ null เมื่อไม่มีราคาจริง
  const chartData = useMemo(() => {
    const today = bangkokDayKey(new Date())
    const todayUTC = Date.parse(`${today}T00:00:00Z`)

    return Array.from({ length: chartDays }, (_, index) => {
      const dayKey = new Date(
        todayUTC - (chartDays - 1 - index) * DAY_MS
      ).toISOString().slice(0, 10)
      const item = dailyHistory.get(dayKey)

      return {
        dayKey,
        averagePrice: item ? item.averagePrice : null,
        timestamp: item?.timestamp ?? null,
        sourceCount: item?.sourceCount ?? null,
        needsReview: Boolean(item && Number(item.minPrice) <= 0),
      }
    })
  }, [dailyHistory, chartDays])

  const observedDays = chartData.filter(
    (item) => Number.isFinite(item.averagePrice)
  )
  const missingDays = chartData.filter((item) => item.averagePrice === null)
  const reviewDays = chartData.filter((item) => item.needsReview)
  const highestPrice = observedDays.length
    ? Math.max(...observedDays.map((item) => item.averagePrice)) : null
  const lowestPrice = observedDays.length
    ? Math.min(...observedDays.map((item) => item.averagePrice)) : null
  const averagePeriodPrice = observedDays.length
    ? observedDays.reduce((sum, item) => sum + item.averagePrice, 0) / observedDays.length
    : null
  const latestHistory = Array.from(dailyHistory.values())
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .slice(-4)
    .reverse()

  async function loadPriceHistory(cropKey) {
    setHistoryLoading(true)
    setHistoryError('')
    setHistory([])
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/history?crop=${encodeURIComponent(cropKey)}`
      )
      if (!response.ok) throw new Error(`History Server ${response.status}`)

      const result = await response.json()
      if (!Array.isArray(result.data)) throw new Error('ข้อมูลประวัติไม่ถูกต้อง')
      // ไม่กรอง sourceCount === 2 เพราะบางวันมีราคาจากเพียงตลาดเดียว
      setHistory(result.data)
    } catch (err) {
      console.error('โหลดราคาย้อนหลังไม่สำเร็จ:', err)
      setHistoryError(err.message || 'โหลดราคาย้อนหลังไม่สำเร็จ')
    } finally {
      setHistoryLoading(false)
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
            {historyLoading ? (
              <p>กำลังโหลดประวัติราคา...</p>
            ) : historyError ? (
              <p>โหลดประวัติไม่สำเร็จ: {historyError}</p>
            ) : latestHistory.length === 0 ? (
              <p>ยังไม่มีข้อมูลราคาย้อนหลัง</p>
            ) : (
              <>
                <p>แสดงวันละหนึ่งรายการจากข้อมูลที่บันทึกจริง</p>
                {latestHistory.map((item) => (
                  <div key={item.dayKey}>
                    <strong>{item.averagePrice} บาท/กก.</strong>
                    <br />
                    <small>
                      {formatDayFull(item.dayKey)} — {item.sourceCount ?? '?'} ตลาด
                    </small>
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="menu-card">
            <h3>📈 กราฟราคา</h3>
            <p className="highest-price">
              ราคาสูงสุด {highestPrice ?? '-'} บาท/กก.
            </p>
            <p className="lowest-price">
              ราคาต่ำสุด {lowestPrice ?? '-'} บาท/กก.
            </p>
            <p className="average-price">
              ราคาเฉลี่ย {averagePeriodPrice === null ? '-' : averagePeriodPrice.toFixed(2)} บาท/กก.
            </p>

            <div className="chart-range-buttons">
              {[7, 30, 90].map((days) => (
                <button
                  key={days}
                  className={chartDays === days ? 'active' : ''}
                  onClick={() => setChartDays(days)}
                >
                  {days} วัน
                </button>
              ))}
            </div>

            <p>
              มีราคาจริง {observedDays.length} วัน จาก {chartDays} วัน
              {missingDays.length > 0 && ` · ไม่มีข้อมูล ${missingDays.length} วัน`}
            </p>
            {chartDays === 7 && missingDays.length > 0 && (
              <p>วันที่ไม่มีข้อมูล: {missingDays.map((item) => formatDayShort(item.dayKey)).join(', ')}</p>
            )}
            {reviewDays.length > 0 && (
              <p>⚠️ มี {reviewDays.length} วันซึ่งข้อมูลต้นทางระบุราคาต่ำสุดเป็น 0 ควรตรวจสอบก่อนวิเคราะห์</p>
            )}
            <p>วันที่ไม่มีข้อมูลจะแสดงเป็นช่องว่าง ไม่สร้างราคาขึ้นมาแทน</p>

            {historyLoading ? (
              <p>กำลังโหลดกราฟราคา...</p>
            ) : historyError ? (
              <p>โหลดกราฟไม่สำเร็จ: {historyError}</p>
            ) : observedDays.length === 0 ? (
              <p>ยังไม่มีข้อมูลราคาในช่วง {chartDays} วันที่เลือก</p>
            ) : (
              <div className="line-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="dayKey"
                      tickFormatter={formatDayShort}
                      minTickGap={20}
                    />
                    <YAxis domain={['dataMin - 10', 'dataMax + 10']} />
                    <Tooltip
                      filterNull={false}
                      labelFormatter={formatDayFull}
                      formatter={(value) => [
                        value == null ? 'ไม่มีข้อมูล' : `${value} บาท/กก.`,
                        'ราคาเฉลี่ย',
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="averagePrice"
                      connectNulls={false}
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