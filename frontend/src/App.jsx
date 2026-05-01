import { useState, useRef, useEffect, useCallback } from 'react'
import axios from 'axios'

const API_BASE = 'http://localhost:3001/api'

export default function App() {
  const [mode, setMode] = useState('home')
  const [loading, setLoading] = useState(false)
  const [generatedQuestions, setGeneratedQuestions] = useState(null)
  const [generatedTranscript, setGeneratedTranscript] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [stage, setStage] = useState('')
  const abortControllerRef = useRef(null)
  const activeTabRef = useRef(0)
  const timerRef = useRef(null)
  const startTimeRef = useRef(null)
  const timeoutRef = useRef(null)
  const stageTimersRef = useRef([])

  const clearAllTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    stageTimersRef.current.forEach(id => clearTimeout(id))
    stageTimersRef.current = []
  }, [])

  useEffect(() => {
    return () => {
      clearAllTimers()
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [clearAllTimers])

  const handleGenerate = async ({ activeTab, textInput, audioBlob, audioFile }) => {
    activeTabRef.current = activeTab
    setLoading(true)
    setGeneratedQuestions(null)
    setGeneratedTranscript('')
    setElapsedSeconds(0)
    clearAllTimers()

    const controller = new AbortController()
    abortControllerRef.current = controller

    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    // 90 秒超时自动取消
    timeoutRef.current = setTimeout(() => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      setLoading(false)
      clearAllTimers()
      setStage('')
    }, 90000)

    if (activeTab === 0) {
      setStage('generating')
    } else {
      setStage('uploading')
      const t1 = setTimeout(() => setStage('asr'), 3000)
      const t2 = setTimeout(() => setStage('generating'), 15000)
      stageTimersRef.current = [t1, t2]
    }

    try {
      let res
      if (activeTab === 0) {
        res = await axios.post(`${API_BASE}/generate`, { text: textInput }, { signal: controller.signal })
      } else {
        const formData = new FormData()
        if (activeTab === 1) {
          formData.append('audio', audioBlob, 'recording.webm')
        } else {
          formData.append('audio', audioFile)
        }
        res = await axios.post(`${API_BASE}/voice-to-questions`, formData, { signal: controller.signal })
      }

      if (res.data.success && res.data.questions?.length > 0) {
        setGeneratedQuestions(res.data.questions)
        setGeneratedTranscript(res.data.transcript || '')
      } else {
        throw new Error('生成题目失败，请重试')
      }
    } catch (err) {
      if (axios.isCancel(err) || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
        return
      }
      throw err
    } finally {
      setLoading(false)
      setStage('')
      clearAllTimers()
      abortControllerRef.current = null
    }
  }

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  const handleStartQuiz = () => {
    setMode('quiz')
  }

  const handleResetGenerate = () => {
    setGeneratedQuestions(null)
    setGeneratedTranscript('')
    setElapsedSeconds(0)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {mode === 'home' && (
          <HomePage
            loading={loading}
            generatedQuestions={generatedQuestions}
            elapsedSeconds={elapsedSeconds}
            stage={stage}
            onGenerate={handleGenerate}
            onCancel={handleCancel}
            onStartQuiz={handleStartQuiz}
            onReset={handleResetGenerate}
            onGoWrong={() => setMode('wrong')}
          />
        )}
        {mode === 'quiz' && generatedQuestions && (
          <QuizPage
            questions={generatedQuestions}
            transcript={generatedTranscript}
            onBack={() => setMode('home')}
            onGoWrong={() => setMode('wrong')}
          />
        )}
        {mode === 'wrong' && <WrongPage onBack={() => setMode('home')} />}
      </div>
    </div>
  )
}

// ==================== Toast 通知组件（支持 error / info / success） ====================
function Toast({ toast, onClose }) {
  const message = toast?.message
  const type = toast?.type || 'error'
  const bgMap = { error: 'bg-red-500', info: 'bg-blue-500', success: 'bg-green-500' }

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [message, onClose])

  if (!message) return null

  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 text-white rounded-xl shadow-lg text-sm font-medium transition-opacity duration-300 ${bgMap[type] || bgMap.error}`}>
      {message}
    </div>
  )
}

// ==================== 首页 ====================
function HomePage({ loading, generatedQuestions, elapsedSeconds, stage, onGenerate, onCancel, onStartQuiz, onReset, onGoWrong }) {
  const [activeTab, setActiveTab] = useState(0)
  const [toast, setToast] = useState(null)

  // Tab 1: 文字输入
  const [textInput, setTextInput] = useState('')
  const charCount = textInput.length

  // Tab 2: 录音
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [audioDuration, setAudioDuration] = useState(0)
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const recTimerRef = useRef(null)
  const MAX_RECORD_SECONDS = 180

  // Tab 3: 文件上传
  const [audioFile, setAudioFile] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const MAX_FILE_SIZE = 8 * 1024 * 1024 // 8MB

  // 检测 90 秒超时（loading 结束但无结果且耗时接近 90 秒）
  const loadingStartRef = useRef(0)
  const prevLoadingRef = useRef(false)
  useEffect(() => {
    if (loading) {
      loadingStartRef.current = Date.now()
    } else if (prevLoadingRef.current && !loading && !generatedQuestions) {
      if (Date.now() - loadingStartRef.current >= 87000) {
        setToast({ message: '请求超时，请检查网络或缩短输入内容', type: 'error' })
      }
    }
    prevLoadingRef.current = loading
  }, [loading, generatedQuestions])

  // 清理录音资源
  const cleanupRecording = useCallback(() => {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  // 开始录音
  const startRecording = async () => {
    try {
      if (isRecording) {
        stopRecording()
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      const chunks = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setAudioBlob(blob)
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)
        cleanupRecording()

        const audioEl = document.createElement('audio')
        audioEl.src = url
        audioEl.addEventListener('loadedmetadata', () => {
          setAudioDuration(Math.round(audioEl.duration))
        })
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingSeconds(0)

      recTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= MAX_RECORD_SECONDS - 1) {
            stopRecording()
            return prev
          }
          return prev + 1
        })
      }, 1000)
    } catch (err) {
      setToast({ message: '无法访问麦克风: ' + err.message, type: 'error' })
    }
  }

  // 停止录音
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  // 生成题目（校验 → 调 App 层 onGenerate）
  const handleGenerateClick = async () => {
    if (activeTab === 0 && charCount < 50) {
      return setToast({ message: '请至少输入 50 个字', type: 'error' })
    }
    if (activeTab === 1 && !audioBlob) {
      return setToast({ message: '请先录音', type: 'error' })
    }
    if (activeTab === 2 && !audioFile) {
      return setToast({ message: '请先上传音频文件', type: 'error' })
    }

    try {
      await onGenerate({ activeTab, textInput, audioBlob, audioFile })
    } catch (err) {
      setToast({ message: '请求失败: ' + (err.response?.data?.error || err.message), type: 'error' })
    }
  }

  // 取消生成
  const handleStopClick = () => {
    onCancel?.()
    setToast({ message: '已取消生成', type: 'info' })
  }

  // 文件校验
  const processFile = (file) => {
    const allowedTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
      'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/webm',
    ]
    const allowedExts = ['.mp3', '.wav', '.m4a', '.aac', '.amr', '.webm']

    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
      setToast({ message: '不支持的文件格式，请上传 mp3/wav/m4a/aac/amr 文件', type: 'error' })
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setToast({ message: '文件大小不能超过 8MB', type: 'error' })
      return
    }
    setAudioFile(file)
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  // 格式化时间
  const formatTime = (sec) => {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  // ---- 状态 UI：loading / 已生成 / 空白 ----
  const stageLabelMap = { uploading: '📤 上传中...', asr: '🎙️ AI 识别语音中...', generating: '🤖 AI 出题中...' }

  const renderBody = () => {
    if (loading) {
      return (
        <>
          <div className="bg-white rounded-2xl shadow-md p-10 flex flex-col items-center">
            <svg className="animate-spin h-10 w-10 text-blue-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-gray-700 font-medium text-lg mb-1">
              {stageLabelMap[stage] || 'AI 还在出题中...'}
            </p>
            <p className="text-gray-400 text-sm">已等待 {formatTime(elapsedSeconds)} 秒</p>
            <p className="text-gray-300 text-xs mt-3">你可以切换到其他页面，出题会在后台继续</p>
          </div>
          <button
            onClick={handleStopClick}
            className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-md transition flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 active:scale-[0.98]"
          >
            ⏹️ 停止生成 · {stageLabelMap[stage] || '处理中'} ({elapsedSeconds}s)
          </button>
        </>
      )
    }

    if (generatedQuestions) {
      return (
        <div className="bg-white rounded-2xl shadow-md p-8 flex flex-col items-center">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-gray-700 font-medium text-lg mb-1">题目已生成</p>
          <p className="text-gray-400 text-sm mb-5">
            共 {generatedQuestions.length} 道题，点击查看开始答题
          </p>
          <div className="flex gap-3">
            <button
              onClick={onStartQuiz}
              className="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition shadow-md"
            >
              📝 查看题目
            </button>
            <button
              onClick={onReset}
              className="px-5 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium hover:bg-gray-200 transition"
            >
              🔄 重新出题
            </button>
          </div>
        </div>
      )
    }

    // 空白状态：正常输入界面
    return (
      <>
        {/* Tab 切换 */}
        <div className="flex bg-white rounded-2xl shadow-md p-1 mb-4">
          {['✍️ 粘贴文字', '🎤 录音', '📁 上传文件'].map((label, i) => (
            <button
              key={i}
              onClick={() => setActiveTab(i)}
              className={
                'flex-1 py-2.5 text-sm font-medium rounded-xl transition ' +
                (activeTab === i
                  ? 'bg-blue-500 text-white shadow'
                  : 'text-gray-500 hover:text-gray-700')
              }
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab 内容区 */}
        <div className="bg-white rounded-2xl shadow-md p-5 mb-4">
          {/* Tab 1: 粘贴文字 */}
          {activeTab === 0 && (
            <div>
              <textarea
                className="w-full min-h-[280px] p-4 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm leading-relaxed"
                placeholder="在这里粘贴笔记/课件/教材内容..."
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
              />
              <div className="flex items-center justify-between mt-2 px-1">
                <span className={`text-xs ${charCount >= 50 ? 'text-gray-400' : 'text-orange-400 font-medium'}`}>
                  已输入 {charCount} 字 {charCount < 50 && `（还需 ${50 - charCount} 字）`}
                </span>
                {charCount >= 50 && (
                  <span className="text-xs text-green-500 font-medium">✓ 已达到最低字数要求</span>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: 录音 */}
          {activeTab === 1 && (
            <div className="flex flex-col items-center py-6">
              {!audioUrl && (
                <>
                  <button
                    onClick={startRecording}
                    className={
                      'w-32 h-32 rounded-full flex items-center justify-center text-white text-2xl font-bold transition-all shadow-lg ' +
                      (isRecording
                        ? 'bg-red-500 animate-pulse'
                        : 'bg-blue-500 hover:bg-blue-600 hover:scale-105')
                    }
                  >
                    {isRecording ? '⏹' : '🎤'}
                  </button>
                  <p className="mt-4 text-sm text-gray-500">
                    {isRecording ? '录音中，点击停止' : '点击开始录音'}
                  </p>
                  {isRecording && (
                    <div className="mt-2 flex items-center gap-2 text-red-500 text-sm font-mono">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                      {formatTime(recordingSeconds)} / {formatTime(MAX_RECORD_SECONDS)}
                    </div>
                  )}
                </>
              )}

              {/* 录音完成：显示回放和重新录制 */}
              {audioUrl && !isRecording && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-green-500 text-sm font-medium mb-3">
                    ✅ 录制完成 · 时长 {formatTime(audioDuration)}
                  </div>
                  <audio controls className="w-full max-w-sm mb-4">
                    <source src={audioUrl} type="audio/webm" />
                    你的浏览器不支持音频播放
                  </audio>
                  <button
                    onClick={() => {
                      if (audioUrl) URL.revokeObjectURL(audioUrl)
                      setAudioUrl(null)
                      setAudioBlob(null)
                      setAudioDuration(0)
                    }}
                    className="text-sm text-blue-500 hover:text-blue-600 transition"
                  >
                    🔄 重新录制
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: 上传文件 */}
          {activeTab === 2 && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/mp3,audio/wav,audio/m4a,audio/aac,audio/amr,.mp3,.wav,.m4a,.aac,.amr"
                onChange={handleFileChange}
                className="hidden"
              />
              {!audioFile ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDragOver(true)
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={
                    'border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition ' +
                    (isDragOver
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/30')
                  }
                >
                  <p className="text-4xl mb-3">📁</p>
                  <p className="text-sm text-gray-500 mb-1">拖拽音频文件到此处，或点击上传</p>
                  <p className="text-xs text-gray-400">支持 mp3 / wav / m4a / aac / amr 格式，最大 8MB</p>
                </div>
              ) : (
                <div className="flex flex-col items-center py-6">
                  <p className="text-green-500 text-sm font-medium mb-1">✅ 文件已选择</p>
                  <p className="text-gray-700 font-medium">{audioFile.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {(audioFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <button
                    onClick={() => {
                      setAudioFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                    className="mt-3 text-sm text-blue-500 hover:text-blue-600 transition"
                  >
                    🔄 重新选择
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 生成按钮 */}
        <button
          onClick={handleGenerateClick}
          disabled={activeTab === 0 && charCount < 50}
          className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-md transition flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 active:scale-[0.98]"
        >
          ✨ 生成题目
        </button>
      </>
    )
  }

  return (
    <div>
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* 头部（任何状态下都显示） */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">📚 AI 错题集</h1>
          <p className="text-sm text-gray-400 mt-0.5">上传录音 / 粘贴文字，AI 秒出题</p>
        </div>
        <button
          onClick={onGoWrong}
          className="shrink-0 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm hover:bg-gray-50 shadow-sm transition"
        >
          📝 错题本
        </button>
      </div>

      <div className="mt-5">
        {renderBody()}
      </div>
    </div>
  )
}

// ==================== 答题模式 ====================
function QuizPage({ questions, transcript, onBack, onGoWrong }) {
  const [userAnswers, setUserAnswers] = useState({})
  const [submitted, setSubmitted] = useState({})
  const [showTranscript, setShowTranscript] = useState(false)

  // 是否全部答完
  const allAnswered = questions.every((q) => {
    if (q.type === 'short_answer') return submitted[q.id]
    return userAnswers[q.id] !== undefined
  })

  // 得分
  const score = questions.filter((q) => {
    const userAns = userAnswers[q.id]
    if (!userAns) return false
    return userAns.trim().toLowerCase() === (q.answer || '').trim().toLowerCase()
  }).length

  // 选择题点击
  const handleChoiceClick = (q, optionKey) => {
    if (userAnswers[q.id] !== undefined) return
    const newAnswers = { ...userAnswers, [q.id]: optionKey }
    setUserAnswers(newAnswers)

    const correct = optionKey === q.answer
    if (!correct) {
      saveWrongQuestion(q, optionKey)
    }
  }

  // 简答题提交
  const handleShortSubmit = (q) => {
    const inputEl = document.getElementById(`short-input-${q.id}`)
    const userAns = inputEl?.value || ''
    if (!userAns.trim()) return alert('请输入你的答案')
    setUserAnswers({ ...userAnswers, [q.id]: userAns })
    setSubmitted({ ...submitted, [q.id]: true })

    const correct = userAns.trim().toLowerCase() === (q.answer || '').trim().toLowerCase()
    if (!correct) {
      saveWrongQuestion(q, userAns)
    }
  }

  // 保存错题到 localStorage
  const saveWrongQuestion = (q, userAnswer) => {
    try {
      const wrongQuestions = JSON.parse(localStorage.getItem('wrongQuestions') || '[]')
      const exists = wrongQuestions.find((w) => w.question.id === q.id)
      if (exists) return
      wrongQuestions.push({
        question: q,
        userAnswer,
        wrongAt: new Date().toISOString(),
      })
      localStorage.setItem('wrongQuestions', JSON.stringify(wrongQuestions))
    } catch {}
  }

  return (
    <div>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 transition">
          ← 返回首页
        </button>
        <span className="text-sm text-gray-400">
          已答 {Object.keys(userAnswers).length} / {questions.length}
        </span>
      </div>

      {/* transcript 折叠卡片 */}
      {transcript && (
        <div className="bg-white rounded-2xl shadow-md mb-4 overflow-hidden">
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition"
          >
            <span className="text-sm font-medium text-gray-700">📄 识别内容</span>
            <span className="text-gray-400 text-sm">{showTranscript ? '收起 ▲' : '展开 ▼'}</span>
          </button>
          {showTranscript && (
            <div className="px-4 pb-4">
              <p className="text-sm text-gray-600 leading-relaxed bg-gray-50 rounded-xl p-3">
                {transcript}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 题目列表 */}
      {questions.map((q, idx) => {
        const userAns = userAnswers[q.id]
        const isChoice = q.type === 'choice'
        const isCorrect = userAns && userAns.trim().toLowerCase() === (q.answer || '').trim().toLowerCase()
        const isSubmitted = isChoice ? userAns !== undefined : submitted[q.id]

        return (
          <div key={q.id} className="bg-white rounded-2xl shadow-md hover:shadow-lg transition-shadow p-5 mb-4">
            {/* 题号 + 类型徽章 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-gray-400">第 {idx + 1} 题</span>
              <span
                className={
                  'px-2 py-0.5 rounded-full text-xs font-medium ' +
                  (isChoice ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700')
                }
              >
                {isChoice ? '单选' : '简答'}
              </span>
            </div>

            {/* 题目文字 */}
            <p className="text-base font-medium text-gray-800 mb-4">{q.question}</p>

            {/* 选择题选项 */}
            {isChoice && q.options && (
              <div className="space-y-2">
                {q.options.map((opt) => {
                  const key = typeof opt === 'string' ? opt.charAt(0) : opt
                  const label = typeof opt === 'string' ? opt.slice(2).trim() : opt

                  let borderClass = 'border-gray-200 hover:border-blue-300'
                  let bgClass = ''
                  let icon = ''

                  if (userAns !== undefined) {
                    if (key === q.answer) {
                      borderClass = 'border-green-400'
                      bgClass = 'bg-green-50'
                      icon = ' ✓'
                    } else if (key === userAns) {
                      borderClass = 'border-red-400'
                      bgClass = 'bg-red-50'
                      icon = ' ✗'
                    } else {
                      borderClass = 'border-gray-100'
                    }
                  }

                  return (
                    <button
                      key={key}
                      onClick={() => handleChoiceClick(q, key)}
                      disabled={userAns !== undefined}
                      className={`w-full flex items-center text-left p-3 rounded-xl border-2 transition text-sm ${borderClass} ${bgClass} ${
                        userAns !== undefined && key !== q.answer && key !== userAns ? 'text-gray-300' : ''
                      }`}
                    >
                      <span
                        className={
                          'shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mr-3 ' +
                          (userAns !== undefined
                            ? key === q.answer
                              ? 'bg-green-500 text-white'
                              : key === userAns
                              ? 'bg-red-500 text-white'
                              : 'bg-gray-200 text-gray-400'
                            : 'bg-blue-100 text-blue-600')
                        }
                      >
                        {key}
                      </span>
                      <span className="flex-1">{label}</span>
                      {icon && <span className="text-sm">{icon}</span>}
                    </button>
                  )
                })}
              </div>
            )}

            {/* 简答题 */}
            {!isChoice && (
              <div>
                <textarea
                  id={`short-input-${q.id}`}
                  className="w-full min-h-[120px] p-3 border border-gray-200 rounded-xl resize-none text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="请输入你的答案..."
                  disabled={isSubmitted}
                />
                {!isSubmitted ? (
                  <button
                    onClick={() => handleShortSubmit(q)}
                    className="mt-2 px-5 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 transition"
                  >
                    提交答案
                  </button>
                ) : (
                  <p className={`mt-2 text-sm font-medium ${isCorrect ? 'text-green-600' : 'text-red-500'}`}>
                    {isCorrect ? '✅ 回答正确！' : '❌ 回答有误'}
                  </p>
                )}
              </div>
            )}

            {/* 正确答案 + 解析 */}
            {isSubmitted && (
              <div className="mt-4 p-4 bg-blue-50 rounded-xl text-sm">
                {!isCorrect && (
                  <div className="mb-2 space-y-1">
                    <p>
                      <span className="text-red-500 font-medium">你的答案：</span>
                      <span className="text-red-500">{userAns}</span>
                    </p>
                    <p>
                      <span className="text-green-600 font-medium">正确答案：</span>
                      <span className="text-green-600">{q.answer}</span>
                    </p>
                  </div>
                )}
                <p className="text-gray-600">
                  <span className="font-medium">💡 解析：</span>
                  {q.explanation || '暂无解析'}
                </p>
              </div>
            )}
          </div>
        )
      })}

      {/* 得分卡片 */}
      {allAnswered && (
        <div className="bg-white rounded-2xl shadow-md p-6 text-center">
          <p className="text-4xl mb-3">
            {score === questions.length ? '🎉' : score >= questions.length / 2 ? '👍' : '💪'}
          </p>
          <p className="text-2xl font-bold text-gray-800 mb-1">
            {score} / {questions.length}
          </p>
          <p className="text-sm text-gray-400 mb-5">
            {score === questions.length
              ? '全部正确，太棒了！'
              : `答错了 ${questions.length - score} 题，继续加油！`}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onGoWrong}
              className="px-5 py-2.5 bg-orange-50 text-orange-600 rounded-xl font-medium hover:bg-orange-100 transition"
            >
              📝 查看错题本
            </button>
            <button
              onClick={onBack}
              className="px-5 py-2.5 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition"
            >
              🔄 再来一组
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== 错题本 ====================
function WrongPage({ onBack }) {
  const [wrongList, setWrongList] = useState([])

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('wrongQuestions') || '[]')
      setWrongList(stored)
    } catch {
      setWrongList([])
    }
  }, [])

  const handleClear = () => {
    if (window.confirm('确定要清空所有错题吗？此操作不可恢复。')) {
      localStorage.removeItem('wrongQuestions')
      setWrongList([])
    }
  }

  return (
    <div>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 transition">
          ← 返回
        </button>
        {wrongList.length > 0 && (
          <button
            onClick={handleClear}
            className="px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition"
          >
            🗑️ 清空
          </button>
        )}
      </div>

      <h2 className="text-xl font-bold text-gray-800 mb-1">📝 错题本</h2>
      <p className="text-sm text-gray-400 mb-5">共 {wrongList.length} 道错题</p>

      {wrongList.length === 0 && (
        <div className="bg-white rounded-2xl shadow-md p-10 text-center">
          <p className="text-4xl mb-3">💪</p>
          <p className="text-gray-500">暂无错题，继续加油 💪</p>
        </div>
      )}

      {wrongList.map((item, idx) => {
        const q = item.question
        const isChoice = q.type === 'choice'
        const wrongTime = new Date(item.wrongAt).toLocaleString('zh-CN')

        return (
          <div key={idx} className="bg-white rounded-2xl shadow-md p-5 mb-4">
            {/* 时间 + 类型 */}
            <p className="text-xs text-gray-400 mb-2">
              第 {idx + 1} 题 · {isChoice ? '单选题' : '简答题'} · {wrongTime}
            </p>

            {/* 题目 */}
            <p className="text-base font-medium text-gray-800 mb-3">{q.question}</p>

            {/* 选择题选项展示 */}
            {isChoice && q.options && (
              <div className="space-y-1.5 mb-3">
                {q.options.map((opt) => {
                  const key = typeof opt === 'string' ? opt.charAt(0) : opt
                  const label = typeof opt === 'string' ? opt.slice(2).trim() : opt

                  let cls = 'text-sm text-gray-400'
                  if (key === q.answer) cls = 'text-sm text-green-600 font-medium'
                  else if (key === item.userAnswer) cls = 'text-sm text-red-500 line-through'

                  return (
                    <p key={key} className={cls}>
                      {key}. {label}
                    </p>
                  )
                })}
              </div>
            )}

            {/* 答案对比 */}
            <div className="space-y-1 mb-3">
              <p className="text-sm">
                <span className="text-red-500 font-medium">你的答案：</span>
                <span className="text-red-500">{item.userAnswer}</span>
              </p>
              <p className="text-sm">
                <span className="text-green-600 font-medium">正确答案：</span>
                <span className="text-green-600">{q.answer}</span>
              </p>
            </div>

            {/* 解析 */}
            {q.explanation && (
              <p className="text-sm text-gray-600 bg-blue-50 rounded-xl p-3">
                <span className="font-medium">💡 解析：</span>
                {q.explanation}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
