package io.github.neocarlos.hacalmtv

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Door pop-ups over whatever app is on screen: a small glass card in the top-right corner with an
 * open door and the door's name, for a few seconds. Like the doorbell window, the Home button
 * service draws it as an accessibility overlay, so it needs no extra permission, never takes
 * focus or touches, and never pauses the show. Several doors stack, newest at the bottom. A "left
 * open" pop-up stays until the page says the door closed.
 */
class DoorPopups(private val service: AccessibilityService) {
    private val wm = service.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var stack: LinearLayout? = null

    /** Sizes are designed for a 1920-wide screen and scaled to the real one. */
    private val unit: Float get() = service.resources.displayMetrics.widthPixels / 1920f

    private fun px(v: Float) = (v * unit).toInt()

    /** Pop-ups that stay until hidden ("left open"), by door. */
    private val staying = HashMap<String, View>()

    /**
     * Shows a pop-up for a few seconds; with `stay`, until hide(id) instead (a backstop takes it
     * away after half an hour, in case the page that would hide it is gone).
     */
    fun show(id: String, name: String, left: Boolean, stay: Boolean) {
        val box = stack ?: addStack() ?: return
        if (stay) staying.remove(id)?.let { remove(it) }
        val card = card(name, left)
        box.addView(card)
        card.alpha = 0f
        card.translationY = -px(14f).toFloat()
        card.animate().alpha(1f).translationY(0f).setDuration(350).start()
        if (stay) staying[id] = card
        handler.postDelayed({
            if (stay && staying[id] === card) staying.remove(id)
            remove(card)
        }, if (stay) STAY_MAX_MS else SHOW_MS)
    }

    fun hide(id: String) {
        staying.remove(id)?.let { remove(it) }
    }

    private fun remove(card: View) {
        val box = stack ?: return
        if (card.parent !== box) return
        card.animate().alpha(0f).setDuration(350).withEndAction {
            box.removeView(card)
            if (box.childCount == 0) removeStack()
        }.start()
    }

    private fun addStack(): LinearLayout? {
        val box = LinearLayout(service).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.END
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = px(56f)
            y = px(56f)
        }
        return try {
            wm.addView(box, params)
            stack = box
            box
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't show the door pop-up", e)
            null
        }
    }

    private fun removeStack() {
        val box = stack ?: return
        stack = null
        try {
            wm.removeView(box)
        } catch (e: Exception) {
            Log.w(TAG, "Door pop-up was already gone", e)
        }
    }

    fun close() {
        handler.removeCallbacksAndMessages(null)
        staying.clear()
        removeStack()
    }

    private fun card(name: String, left: Boolean): View {
        val ctx: Context = service
        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(px(18f), px(16f), px(30f), px(16f))
            background = GradientDrawable().apply {
                cornerRadius = px(26f).toFloat()
                setColor(Color.argb(209, 16, 18, 20))
                setStroke(maxOf(1, px(1f)), Color.argb(36, 255, 255, 255))
            }
        }
        card.addView(DoorIcon(ctx, left), LinearLayout.LayoutParams(px(64f), px(64f)).apply { marginEnd = px(14f) })

        val text = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        text.addView(TextView(ctx).apply {
            this.text = name
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_PX, px(28f).toFloat())
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            maxLines = 1
        })
        if (left) {
            text.addView(TextView(ctx).apply {
                this.text = "Left open"
                setTextColor(Color.rgb(255, 138, 141))
                setTextSize(TypedValue.COMPLEX_UNIT_PX, px(20f).toFloat())
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            })
        }
        card.addView(text)

        // Space between stacked cards.
        return LinearLayout(ctx).apply {
            gravity = Gravity.END
            setPadding(0, 0, 0, px(14f))
            addView(card)
        }
    }

    /**
     * The open-door icon on a soft square (the same drawing as DOOR_ICON in doors.ts, on a 24-unit
     * grid), with a red "!" badge when the door was left open.
     */
    private inner class DoorIcon(ctx: Context, private val left: Boolean) : View(ctx) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        override fun onDraw(canvas: Canvas) {
            val s = width.toFloat()
            val pad = s * 0.06f
            val tile = RectF(pad, pad, s - pad, s - pad)
            paint.style = Paint.Style.FILL
            paint.color = Color.argb(26, 255, 255, 255)
            canvas.drawRoundRect(tile, tile.width() * 0.28f, tile.width() * 0.28f, paint)

            // The door, 36/56 of the tile, centred.
            val k = tile.width() * (36f / 56f) / 24f
            val ox = tile.centerX() - 12 * k
            val oy = tile.centerY() - 12 * k
            fun x(v: Float) = ox + v * k
            fun y(v: Float) = oy + v * k

            paint.color = Color.WHITE
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2 * k
            paint.strokeCap = Paint.Cap.ROUND
            paint.strokeJoin = Paint.Join.ROUND
            canvas.drawLine(x(3f), y(21.5f), x(21f), y(21.5f), paint)
            canvas.drawPath(Path().apply {
                moveTo(x(6f), y(21.5f)); lineTo(x(6f), y(3.5f)); lineTo(x(18f), y(3.5f)); lineTo(x(18f), y(21.5f))
            }, paint)
            paint.style = Paint.Style.FILL
            canvas.drawPath(Path().apply {
                moveTo(x(6f), y(3.5f)); lineTo(x(14f), y(5.7f)); lineTo(x(14f), y(23f)); lineTo(x(6f), y(21.5f)); close()
            }, paint)
            paint.color = Color.rgb(21, 24, 27)
            canvas.drawCircle(x(11.6f), y(13.6f), 1.1f * k, paint)

            if (left) {
                val r = s * 0.2f
                val cx = s - r
                val cy = r
                paint.color = Color.argb(230, 16, 18, 20)
                canvas.drawCircle(cx, cy, r + s * 0.045f, paint)
                paint.color = Color.rgb(229, 72, 77)
                canvas.drawCircle(cx, cy, r, paint)
                paint.color = Color.WHITE
                paint.textAlign = Paint.Align.CENTER
                paint.textSize = r * 1.4f
                paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                canvas.drawText("!", cx, cy - (paint.descent() + paint.ascent()) / 2, paint)
            }
        }
    }

    companion object {
        private const val TAG = "CalmTV"
        private const val SHOW_MS = 5000L
        private const val STAY_MAX_MS = 30 * 60 * 1000L
    }
}
