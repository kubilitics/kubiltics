package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
)

// Logger defines the interface for audit logging
type Logger interface {
	// Log logs an audit event
	Log(ctx context.Context, event *Event) error

	// LogInvestigation logs investigation lifecycle events
	LogInvestigationStarted(ctx context.Context, investigationID string) error
	LogInvestigationCompleted(ctx context.Context, investigationID string, duration time.Duration) error
	LogInvestigationFailed(ctx context.Context, investigationID string, err error) error

	// LogAction logs action lifecycle events
	LogActionProposed(ctx context.Context, action, resource string) error
	LogActionApproved(ctx context.Context, action, resource, approver string) error
	LogActionExecuted(ctx context.Context, action, resource string, duration time.Duration) error

	// LogSafety logs safety-related events
	LogSafetyViolation(ctx context.Context, rule, resource string) error

	// Sync flushes buffered log entries
	Sync() error

	// Close closes the audit logger
	Close() error
}

// Config represents audit logger configuration
type Config struct {
	// AuditLogPath is the path to the audit log file
	AuditLogPath string

	// AppLogPath is the path to the application log file
	AppLogPath string

	// MaxSize is the maximum size in megabytes before rotation
	MaxSize int

	// MaxBackups is the maximum number of old log files to retain
	MaxBackups int

	// MaxAge is the maximum number of days to retain old log files
	MaxAge int

	// Compress determines if rotated files should be compressed
	Compress bool

	// LogLevel is the minimum log level (debug, info, warn, error)
	LogLevel string
}

// DefaultConfig returns default audit logger configuration
func DefaultConfig() *Config {
	return &Config{
		AuditLogPath: "logs/audit.log",
		AppLogPath:   "logs/app.log",
		MaxSize:      100, // megabytes
		MaxBackups:   10,
		MaxAge:       30, // days
		Compress:     true,
		LogLevel:     "info",
	}
}

// auditLogger implements the Logger interface
type auditLogger struct {
	appLogger   *zap.Logger
	auditLogger *zap.Logger
	config      *Config
	mu          sync.Mutex
	buffer      []*Event
	flushTicker *time.Ticker
	stopCh      chan struct{}
}

// NewLogger creates a new audit logger
func NewLogger(config *Config) (Logger, error) {
	if config == nil {
		config = DefaultConfig()
	}

	// Parse log level
	level, err := zapcore.ParseLevel(config.LogLevel)
	if err != nil {
		return nil, fmt.Errorf("invalid log level %s: %w", config.LogLevel, err)
	}

	// Create encoder config
	encoderConfig := zapcore.EncoderConfig{
		TimeKey:        "timestamp",
		LevelKey:       "level",
		NameKey:        "logger",
		CallerKey:      "caller",
		MessageKey:     "message",
		StacktraceKey:  "stacktrace",
		LineEnding:     zapcore.DefaultLineEnding,
		EncodeLevel:    zapcore.LowercaseLevelEncoder,
		EncodeTime:     zapcore.ISO8601TimeEncoder,
		EncodeDuration: zapcore.SecondsDurationEncoder,
		EncodeCaller:   zapcore.ShortCallerEncoder,
	}

	// Create application logger with rotation
	appRotator := &lumberjack.Logger{
		Filename:   config.AppLogPath,
		MaxSize:    config.MaxSize,
		MaxBackups: config.MaxBackups,
		MaxAge:     config.MaxAge,
		Compress:   config.Compress,
	}

	appCore := zapcore.NewCore(
		zapcore.NewJSONEncoder(encoderConfig),
		zapcore.AddSync(appRotator),
		level,
	)

	appLogger := zap.New(appCore, zap.AddCaller(), zap.AddStacktrace(zapcore.ErrorLevel))

	// Create audit logger with rotation (always INFO level, append-only)
	auditRotator := &lumberjack.Logger{
		Filename:   config.AuditLogPath,
		MaxSize:    config.MaxSize,
		MaxBackups: config.MaxBackups,
		MaxAge:     config.MaxAge,
		Compress:   config.Compress,
	}

	auditCore := zapcore.NewCore(
		zapcore.NewJSONEncoder(encoderConfig),
		zapcore.AddSync(auditRotator),
		zapcore.InfoLevel, // Audit logs are always INFO level
	)

	auditZapLogger := zap.New(auditCore)

	// Create the logger instance
	logger := &auditLogger{
		appLogger:   appLogger,
		auditLogger: auditZapLogger,
		config:      config,
		buffer:      make([]*Event, 0, 100),
		flushTicker: time.NewTicker(1 * time.Second),
		stopCh:      make(chan struct{}),
	}

	// Start auto-flush goroutine
	go logger.autoFlush()

	return logger, nil
}

// Log logs an audit event
func (l *auditLogger) Log(ctx context.Context, event *Event) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Add to buffer
	l.buffer = append(l.buffer, event)

	// Flush if buffer is full
	if len(l.buffer) >= 100 {
		return l.flushLocked()
	}

	return nil
}

// flushLocked flushes the buffer (caller must hold lock)
func (l *auditLogger) flushLocked() error {
	if len(l.buffer) == 0 {
		return nil
	}

	// Write all buffered events
	for _, event := range l.buffer {
		eventJSON, err := json.Marshal(event)
		if err != nil {
			l.appLogger.Error("failed to marshal audit event",
				zap.Error(err),
				zap.String("event_type", string(event.EventType)),
			)
			continue
		}

		l.auditLogger.Info(string(eventJSON),
			zap.String("correlation_id", event.CorrelationID),
			zap.String("event_type", string(event.EventType)),
			zap.String("result", string(event.Result)),
		)
	}

	// Clear buffer
	l.buffer = l.buffer[:0]

	return nil
}

// autoFlush periodically flushes the buffer
func (l *auditLogger) autoFlush() {
	for {
		select {
		case <-l.flushTicker.C:
			l.mu.Lock()
			_ = l.flushLocked()
			l.mu.Unlock()
		case <-l.stopCh:
			return
		}
	}
}

// LogInvestigationStarted logs when an investigation starts
func (l *auditLogger) LogInvestigationStarted(ctx context.Context, investigationID string) error {
	event := NewEvent(EventInvestigationStarted).
		WithCorrelationID(investigationID).
		WithResult(ResultSuccess).
		WithDescription(fmt.Sprintf("Investigation %s started", investigationID))

	return l.Log(ctx, event)
}

// LogInvestigationCompleted logs when an investigation completes
func (l *auditLogger) LogInvestigationCompleted(ctx context.Context, investigationID string, duration time.Duration) error {
	event := NewEvent(EventInvestigationCompleted).
		WithCorrelationID(investigationID).
		WithResult(ResultSuccess).
		WithDuration(duration).
		WithDescription(fmt.Sprintf("Investigation %s completed", investigationID))

	return l.Log(ctx, event)
}

// LogInvestigationFailed logs when an investigation fails
func (l *auditLogger) LogInvestigationFailed(ctx context.Context, investigationID string, err error) error {
	event := NewEvent(EventInvestigationFailed).
		WithCorrelationID(investigationID).
		WithError(err, "investigation_error").
		WithDescription(fmt.Sprintf("Investigation %s failed", investigationID))

	return l.Log(ctx, event)
}

// LogActionProposed logs when an action is proposed
func (l *auditLogger) LogActionProposed(ctx context.Context, action, resource string) error {
	event := NewEvent(EventActionProposed).
		WithAction(action).
		WithResource(resource, "").
		WithResult(ResultPending).
		WithDescription(fmt.Sprintf("Action %s proposed for %s", action, resource))

	return l.Log(ctx, event)
}

// LogActionApproved logs when an action is approved
func (l *auditLogger) LogActionApproved(ctx context.Context, action, resource, approver string) error {
	event := NewEvent(EventActionApproved).
		WithAction(action).
		WithResource(resource, "").
		WithUser(approver).
		WithResult(ResultSuccess).
		WithDescription(fmt.Sprintf("Action %s approved for %s by %s", action, resource, approver))

	return l.Log(ctx, event)
}

// LogActionExecuted logs when an action is executed
func (l *auditLogger) LogActionExecuted(ctx context.Context, action, resource string, duration time.Duration) error {
	event := NewEvent(EventActionExecuted).
		WithAction(action).
		WithResource(resource, "").
		WithResult(ResultSuccess).
		WithDuration(duration).
		WithDescription(fmt.Sprintf("Action %s executed for %s", action, resource))

	return l.Log(ctx, event)
}

// LogSafetyViolation logs safety policy violations
func (l *auditLogger) LogSafetyViolation(ctx context.Context, rule, resource string) error {
	event := NewEvent(EventSafetyPolicyViolation).
		WithResource(resource, "").
		WithResult(ResultDenied).
		WithMetadata("rule", rule).
		WithDescription(fmt.Sprintf("Safety violation: %s for %s", rule, resource))

	return l.Log(ctx, event)
}

// Sync flushes buffered log entries
func (l *auditLogger) Sync() error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if err := l.flushLocked(); err != nil {
		return err
	}

	if err := l.auditLogger.Sync(); err != nil {
		return err
	}

	return l.appLogger.Sync()
}

// Close closes the audit logger
func (l *auditLogger) Close() error {
	close(l.stopCh)
	l.flushTicker.Stop()

	if err := l.Sync(); err != nil {
		return err
	}

	return nil
}

// GetCorrelationID extracts correlation ID from context
func GetCorrelationID(ctx context.Context) string {
	if id, ok := ctx.Value("correlation_id").(string); ok {
		return id
	}
	return ""
}

// WithCorrelationID adds correlation ID to context
func WithCorrelationID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, "correlation_id", id)
}

// GenerateCorrelationID generates a new correlation ID
func GenerateCorrelationID() string {
	return fmt.Sprintf("%d-%d", time.Now().UnixNano(), os.Getpid())
}
