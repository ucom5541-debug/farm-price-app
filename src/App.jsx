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

function formatMarketTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'ไม่ทราบเวลา'
  return new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
}

// Only expose allowlisted connection diagnostics, never raw URLs, headers or tokens.
function safeConnectionDetails(value) {
  if (typeof value !== 'string') return []
  const details = []
  const status = value.match(/(?:HTTP\s*|ตอบกลับ\s*)([45]\d{2})\b/i)
  if (status) details.push(`สถานะ HTTP: ${status[1]}`)
  const code = value.match(/\b(EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)\b/)
  if (code) details.push(`รหัสการเชื่อมต่อ: ${code[1]}`)
  for (const raw of value.match(/https?:\/\/[^\s<>"']+/gi) || []) {
    try {
      const parsed = new URL(raw)
      // Market hosts are known public destinations. Do not expose arbitrary host data.
      if (['www.taladsrimuang.com', 'taladsrimuang.com', 'api.simummuangmarket.com'].includes(parsed.hostname)) {
        details.push(`ปลายทาง: ${parsed.hostname}`)
      }
    } catch { /* An invalid URL must not expose its original text. */ }
  }
  return [...new Set(details)]
}

function marketIssueMessage(market) {
  const qualityMessages = {
    invalid_range: 'ช่วงราคาผิดปกติ: ราคาต่ำสุดสูงกว่าราคาสูงสุด',
    incomplete_range: 'ช่วงราคาไม่ครบ มีราคาศูนย์ด้านเดียว',
    missing_price: 'ไม่มีราคา', invalid_value: 'ข้อมูลราคาไม่ถูกต้อง',
  }
  if (market.status === 'selected_size_unavailable') {
    return `ขนาดที่เลือกใช้ไม่ได้: ${qualityMessages[market.selectedSizeStatus || market.quality?.status] || 'ไม่มีช่วงราคาที่ผ่านการตรวจสอบ'}`
  }
  const messages = {
    ...qualityMessages,
    load_failed: 'ตลาดโหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่ภายหลัง',
    incomplete_data: 'ตลาดโหลดข้อมูลไม่สำเร็จหรือข้อมูลไม่ครบ กรุณาลองใหม่ภายหลัง',
    stale: 'ราคาเก่า ไม่ใช้คำนวณราคาปัจจุบัน', expired: 'ราคาหมดอายุ ไม่ใช้คำนวณ',
    invalid_timestamp: 'เวลาราคาต้นทางไม่ถูกต้องหรือไม่สามารถอ่านได้',
    unknown_timestamp: 'ไม่สามารถยืนยันเวลาราคา',
    selection_required: 'รอยืนยันรหัสสินค้าหลัก', selected_product_not_found: 'ไม่พบสินค้าหลักที่ยืนยันไว้ ต้องตรวจสอบข้อมูล',
    product_identity_mismatch: 'ชื่อสินค้าหลักไม่ตรงกับรหัสที่ยืนยัน ต้องตรวจสอบข้อมูล',
    unsupported_unit: 'หน่วยสินค้าไม่ใช่กิโลกรัม', invalid_mid: 'ราคากลางไม่สอดคล้องกับช่วงราคา',
    product_not_found: 'ไม่พบสินค้าที่ต้องการ', duplicate_product: 'พบรหัสสินค้าซ้ำ ต้องตรวจสอบข้อมูล',
    size_selection_required: 'ต้องยืนยันขนาดสินค้า', no_valid_price: 'ไม่มีช่วงราคาที่ผ่านการตรวจสอบ',
    unverified_price: 'ข้อมูลสินค้ายังไม่ผ่านการตรวจสอบ',
  }
  if (messages[market.status]) return messages[market.status]
  // Older APIs sometimes omit status. Preserve known Thai reasons only.
  if (['ขนาดที่เลือกใช้ไม่ได้', 'รอยืนยันรหัสสินค้าหลัก', 'ตลาดโหลดข้อมูลไม่สำเร็จ', 'ไม่พบสินค้า'].includes(market.reason)) return market.reason
  return 'ยังไม่มีราคาที่ผ่านการตรวจสอบจากตลาดนี้'
}

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

function buildDailyHistoryMap(history, selectedCrop) {
  const latestByDay = new Map()
  history.forEach((item) => {
    const price = Number(item?.averagePrice)
    const dayKey = bangkokDayKey(item?.timestamp)
    if (!dayKey || !Number.isFinite(price) || price <= 0) return
    if (selectedCrop && item?.crop !== selectedCrop) return
    const candidate = { ...item, averagePrice: price, dayKey }
    const key = selectedCrop ? dayKey : `${item.crop}:${dayKey}`
    const previous = latestByDay.get(key)
    if (!previous || isPreferredHistory(candidate, previous)) latestByDay.set(key, candidate)
  })
  return latestByDay
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

  // API returns the append-only daily view; retain legacy deduplication as a safeguard.
  const dailyHistory = useMemo(() => buildDailyHistoryMap(history, selectedCrop), [history, selectedCrop])

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

      setSimumuangData(data)
      const received = data?.data?.data || []
      const usable = received.filter((item) => item.sourceCount > 0 && Number.isFinite(item.averagePrice))
      setServerStatus(!usable.length
        ? 'รับข้อมูลแล้ว แต่ยังไม่มีราคาที่ผ่านเกณฑ์'
        : usable.every((item) => item.priceStatus === 'current')
          ? 'รับข้อมูลแล้ว มีราคาปัจจุบันที่ผ่านการตรวจสอบ'
          : 'รับข้อมูลแล้ว มีราคาเปรียบเทียบที่ยังยืนยันเวลาราคาไม่ได้')
    } catch (err) {
      console.error('โหลดข้อมูลราคาไม่สำเร็จ', safeConnectionDetails(err?.message))

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
            <h3>🏪 สถานะระบบราคาตลาด</h3>

            <p>
              สถานะ:{' '}
              <strong>{serverStatus}</strong>
            </p>

            {loading && <h2>กำลังโหลดราคา...</h2>}

            {error && (
              <>
                <h2>ดึงข้อมูลไม่สำเร็จ</h2>
                <p className="market-error-message">ไม่สามารถโหลดข้อมูลราคาได้ กรุณาลองใหม่ภายหลัง</p>
                {safeConnectionDetails(error).length > 0 && (
                  <details className="market-error-details">
                    <summary>รายละเอียดการเชื่อมต่อที่ปลอดภัย</summary>
                    {safeConnectionDetails(error).map((detail) => <p key={detail}>{detail}</p>)}
                  </details>
                )}
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
<p>{item.priceStatus === 'current' ? 'ราคาปัจจุบันที่ผ่านการตรวจสอบ'
  : item.priceStatus === 'unverified_freshness' ? 'ราคาเปรียบเทียบ — ไม่สามารถยืนยันเวลาราคาครบทุกตลาด'
  : 'ยังไม่มีราคาที่ใช้คำนวณได้'}</p>

<h2>
  {item.averagePrice ?? getPrice(item)}
</h2>

<p>บาท / กก.</p>

<p>
  ใช้ข้อมูล {item.sourceCount ?? 0} ตลาด
</p>
<div className="market-list">
  {Array.isArray(item.markets) && item.markets.map((market, marketIndex) => {
    const sizeLabels = { small: 'เล็ก', medium: 'กลาง', large: 'ใหญ่' }
    const statusLabels = {
      invalid_range: 'ช่วงราคาผิดปกติ: ราคาต่ำสุดสูงกว่าราคาสูงสุด',
      incomplete_range: 'ช่วงราคาไม่ครบ',
      missing_price: 'ไม่มีราคา',
      invalid_value: 'ข้อมูลราคาไม่ถูกต้อง',
    }
    return (
      <div key={`${market.market}-${marketIndex}`}>
        <p>
          {market.market}:{' '}
          {!market.available && market.productName && (
            <>{market.productName} {market.selectedSize && `ขนาด${sizeLabels[market.selectedSize] || market.selectedSize}${market.selectedSize === 'large' ? ' (large)' : ''}`} — </>
          )}
          {market.available ? (
            <>
              {market.productName && `${market.productName} `}
              {market.selectedSize && `ขนาด${sizeLabels[market.selectedSize] || market.selectedSize}${market.selectedSize === 'large' ? ' (large)' : ''} `}
              {market.min === market.max ? market.min : `${market.min} - ${market.max}`} บาท/กก.
            </>
          ) : marketIssueMessage(market)}
        </p>
        {!market.available && safeConnectionDetails(market.reason).length > 0 && (
          <details className="market-error-details">
            <summary>รายละเอียดการเชื่อมต่อที่ปลอดภัย</summary>
            {safeConnectionDetails(market.reason).map((detail) => <p key={detail}>{detail}</p>)}
          </details>
        )}
        {!market.available && market.freshness && (
          <p>สถานะเวลาราคา: {{ current: 'อยู่ในเกณฑ์ปัจจุบัน (ช่วงราคาอาจยังใช้ไม่ได้)',
            stale: 'ราคาเก่า', expired: 'ราคาหมดอายุ', invalid_timestamp: 'เวลาราคาไม่ถูกต้อง',
            unknown_timestamp: 'ไม่สามารถยืนยันเวลาราคา' }[market.freshness.status] || 'ไม่ทราบสถานะ'}</p>
        )}
        {market.available && (
          <p>{market.verifiedCurrent ? 'ราคาปัจจุบันที่ผ่านการตรวจสอบ' : 'ไม่สามารถยืนยันเวลาราคา — ใช้เพื่อเปรียบเทียบ'}</p>
        )}
        {market.freshness?.status === 'stale' && market.quality?.status === 'valid' && (
          <p>ราคาเก่า: {market.min} - {market.max} {market.unit} (ไม่ใช้คำนวณราคาปัจจุบัน)</p>
        )}
        <p>เวลาราคาต้นทาง: {formatMarketTime(market.sourceUpdatedAt)}
          {' · '}เวลาดึงข้อมูล: {formatMarketTime(market.fetchedAt)}</p>
        {market.action_date && <p>เวลาที่ต้นทางระบุเพิ่มเติม: {formatMarketTime(market.action_date)}</p>}
        {market.candidates?.length > 0 && (
          <details>
            <summary>ตรวจสอบสินค้าและขนาด</summary>
            {market.candidates.map((candidate) => (
              <div key={candidate.productId}>
                <p>{candidate.productName} — หน่วย: {candidate.unit?.th || 'ไม่ทราบหน่วย'}
                  {candidate.reasons?.includes('unsupported_unit') && ' (ใช้คำนวณบาท/กก. ไม่ได้)'}
                </p>
                {candidate.sizes.map((range) => (
                  <p key={range.size}>
                    ขนาด{sizeLabels[range.size] || range.size}: {' '}
                    {range.status === 'valid'
                      ? `${range.min} - ${range.max} บาท/${candidate.unit?.th || 'ไม่ทราบหน่วย'}`
                      : (statusLabels[range.status] || 'ข้อมูลราคาไม่ถูกต้อง')}
                    {range.status !== 'valid' && range.raw != null && (
                      <span> (ค่าต้นทาง min/max: {String(range.raw.min ?? 'ไม่ระบุ')} / {String(range.raw.max ?? 'ไม่ระบุ')})</span>
                    )}
                  </p>
                ))}
              </div>
            ))}
          </details>
        )}
      </div>
    )
  })}
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
                      {' · '}{item.priceStatus === 'current' ? 'ผ่านการตรวจสอบ ณ เวลาบันทึก'
                        : item.priceStatus === 'unverified_freshness' ? 'มีราคาที่ไม่ยืนยันเวลาต้นทาง'
                        : item.priceStatus === 'unverified_metadata' ? 'ข้อมูลชนิดหรือขนาดยังไม่ครบ ใช้เปรียบเทียบ'
                        : 'ข้อมูลเดิม ไม่ทราบสถานะเวลาราคา'}
                    </small>
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="menu-card">
            <h3>📈 กราฟราคา</h3>
            <p>แสดงหนึ่งจุดต่อพืชต่อวันจากตลาดที่บันทึกได้ ประวัติบางรายการอาจไม่ยืนยันเวลาราคาต้นทาง</p>
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
            เปรียบเทียบราคาจากตลาดสี่มุมเมืองและตลาดศรีเมือง ราชบุรี
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