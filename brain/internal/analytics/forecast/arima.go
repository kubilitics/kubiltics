package forecast

import (
	"errors"
	"math"
)

// ARIMA represents an AutoRegressive Integrated Moving Average model
// ARIMA(p, d, q) where:
// - p: number of autoregressive terms
// - d: number of differences (for stationarity)
// - q: number of moving average terms
type ARIMA struct {
	p, d, q      int
	coefficients ARIMACoefficients
	fitted       bool
	residuals    []float64
}

// ARIMACoefficients holds the model parameters
type ARIMACoefficients struct {
	AR []float64 // Autoregressive coefficients
	MA []float64 // Moving average coefficients
	C  float64   // Constant term
}

// ForecastResult contains forecast values and confidence intervals
type ForecastResult struct {
	Values     []float64
	Lower95    []float64 // 95% confidence interval lower bound
	Upper95    []float64 // 95% confidence interval upper bound
	StdError   float64
	Confidence float64
}

// NewARIMA creates a new ARIMA model with specified parameters
func NewARIMA(p, d, q int) *ARIMA {
	return &ARIMA{
		p:      p,
		d:      d,
		q:      q,
		fitted: false,
	}
}

// Fit trains the ARIMA model on historical data
func (a *ARIMA) Fit(timeSeries []float64) error {
	if len(timeSeries) < a.p+a.d+a.q+1 {
		return errors.New("insufficient data points for model")
	}

	// Apply differencing to achieve stationarity
	diffSeries := a.difference(timeSeries, a.d)

	// Estimate AR and MA coefficients using Yule-Walker method
	// This is a simplified implementation
	arCoeffs, err := a.estimateAR(diffSeries)
	if err != nil {
		return err
	}

	maCoeffs := a.estimateMA(diffSeries, arCoeffs)

	// Calculate constant term
	c := a.estimateConstant(diffSeries)

	a.coefficients = ARIMACoefficients{
		AR: arCoeffs,
		MA: maCoeffs,
		C:  c,
	}

	// Calculate residuals
	a.residuals = a.calculateResiduals(diffSeries)

	a.fitted = true
	return nil
}

// Forecast predicts future values
func (a *ARIMA) Forecast(steps int) (ForecastResult, error) {
	if !a.fitted {
		return ForecastResult{}, errors.New("model not fitted")
	}

	if steps <= 0 {
		return ForecastResult{}, errors.New("steps must be positive")
	}

	// Generate forecasts
	forecasts := make([]float64, steps)
	stdErrors := make([]float64, steps)

	// Calculate standard error from residuals
	baseStdError := a.calculateStdError()

	for i := 0; i < steps; i++ {
		// Forecast value
		forecast := a.forecastStep(i)
		forecasts[i] = forecast

		// Standard error increases with forecast horizon
		stdErrors[i] = baseStdError * math.Sqrt(float64(i+1))
	}

	// Calculate confidence intervals (95%)
	z := 1.96 // 95% confidence
	lower95 := make([]float64, steps)
	upper95 := make([]float64, steps)

	for i := range forecasts {
		margin := z * stdErrors[i]
		lower95[i] = forecasts[i] - margin
		upper95[i] = forecasts[i] + margin
	}

	return ForecastResult{
		Values:     forecasts,
		Lower95:    lower95,
		Upper95:    upper95,
		StdError:   baseStdError,
		Confidence: 0.95,
	}, nil
}

// difference applies differencing to make series stationary
func (a *ARIMA) difference(series []float64, order int) []float64 {
	if order == 0 {
		return series
	}

	result := make([]float64, len(series)-1)
	for i := 1; i < len(series); i++ {
		result[i-1] = series[i] - series[i-1]
	}

	if order > 1 {
		return a.difference(result, order-1)
	}

	return result
}

// estimateAR estimates autoregressive coefficients using Yule-Walker equations
func (a *ARIMA) estimateAR(series []float64) ([]float64, error) {
	if a.p == 0 {
		return []float64{}, nil
	}

	// Calculate autocorrelations
	acf := a.calculateACF(series, a.p)

	// Solve Yule-Walker equations
	// This is a simplified version - in production, use matrix solver
	coeffs := make([]float64, a.p)

	if a.p == 1 {
		// AR(1): φ₁ = ρ₁
		coeffs[0] = acf[1]
	} else if a.p == 2 {
		// AR(2): solve 2x2 system
		r1 := acf[1]
		r2 := acf[2]

		coeffs[0] = (r1 - r2*r1) / (1 - r1*r1)
		coeffs[1] = (r2 - r1*coeffs[0]) / (1 - r1*r1)
	} else {
		// For higher orders, use simple approximation
		for i := 0; i < a.p; i++ {
			if i+1 < len(acf) {
				coeffs[i] = acf[i+1] * 0.5 // Dampened
			}
		}
	}

	return coeffs, nil
}

// estimateMA estimates moving average coefficients
func (a *ARIMA) estimateMA(series []float64, arCoeffs []float64) []float64 {
	if a.q == 0 {
		return []float64{}
	}

	// Simplified MA estimation
	// In practice, use maximum likelihood or least squares
	coeffs := make([]float64, a.q)

	// Calculate partial autocorrelations
	pacf := a.calculatePACF(series, a.q)

	for i := 0; i < a.q && i < len(pacf); i++ {
		coeffs[i] = -pacf[i] * 0.5 // Dampened and inverted
	}

	return coeffs
}

// estimateConstant calculates the constant term
func (a *ARIMA) estimateConstant(series []float64) float64 {
	if len(series) == 0 {
		return 0
	}

	// Mean of the series
	sum := 0.0
	for _, v := range series {
		sum += v
	}
	return sum / float64(len(series))
}

// calculateResiduals computes model residuals
func (a *ARIMA) calculateResiduals(series []float64) []float64 {
	residuals := make([]float64, len(series))

	for i := range series {
		predicted := a.predictInSample(series, i)
		residuals[i] = series[i] - predicted
	}

	return residuals
}

// predictInSample makes in-sample predictions
func (a *ARIMA) predictInSample(series []float64, index int) float64 {
	if index < a.p {
		return a.coefficients.C
	}

	prediction := a.coefficients.C

	// AR component
	for i, coeff := range a.coefficients.AR {
		if index-i-1 >= 0 {
			prediction += coeff * series[index-i-1]
		}
	}

	// MA component (using residuals)
	for i, coeff := range a.coefficients.MA {
		if index-i-1 >= 0 && index-i-1 < len(a.residuals) {
			prediction += coeff * a.residuals[index-i-1]
		}
	}

	return prediction
}

// forecastStep generates forecast for a single step ahead
func (a *ARIMA) forecastStep(step int) float64 {
	// Simplified forecasting - assumes residuals are zero for future
	forecast := a.coefficients.C

	// AR component decays over time
	decay := 1.0
	for i, coeff := range a.coefficients.AR {
		decay *= 0.9 // Exponential decay
		if step > i {
			forecast += coeff * a.coefficients.C * decay
		}
	}

	return forecast
}

// calculateACF computes autocorrelation function
func (a *ARIMA) calculateACF(series []float64, maxLag int) []float64 {
	n := len(series)
	mean := a.mean(series)

	// Variance
	variance := 0.0
	for _, v := range series {
		variance += (v - mean) * (v - mean)
	}
	variance /= float64(n)

	acf := make([]float64, maxLag+1)
	acf[0] = 1.0

	for lag := 1; lag <= maxLag && lag < n; lag++ {
		covariance := 0.0
		for i := lag; i < n; i++ {
			covariance += (series[i] - mean) * (series[i-lag] - mean)
		}
		covariance /= float64(n)
		acf[lag] = covariance / variance
	}

	return acf
}

// calculatePACF computes partial autocorrelation function
func (a *ARIMA) calculatePACF(series []float64, maxLag int) []float64 {
	// Simplified PACF using Durbin-Levinson recursion
	acf := a.calculateACF(series, maxLag)
	pacf := make([]float64, maxLag+1)
	pacf[0] = 1.0

	if maxLag > 0 && len(acf) > 1 {
		pacf[1] = acf[1]
	}

	// For simplicity, use ACF as approximation for higher lags
	for i := 2; i <= maxLag && i < len(acf); i++ {
		pacf[i] = acf[i] * 0.8 // Dampened
	}

	return pacf
}

// calculateStdError computes standard error from residuals
func (a *ARIMA) calculateStdError() float64 {
	if len(a.residuals) == 0 {
		return 0
	}

	sumSquares := 0.0
	for _, r := range a.residuals {
		sumSquares += r * r
	}

	return math.Sqrt(sumSquares / float64(len(a.residuals)))
}

// mean calculates the mean of a series
func (a *ARIMA) mean(series []float64) float64 {
	if len(series) == 0 {
		return 0
	}

	sum := 0.0
	for _, v := range series {
		sum += v
	}
	return sum / float64(len(series))
}

// GetModelInfo returns information about the fitted model
func (a *ARIMA) GetModelInfo() map[string]interface{} {
	return map[string]interface{}{
		"order":       []int{a.p, a.d, a.q},
		"fitted":      a.fitted,
		"ar_coeffs":   a.coefficients.AR,
		"ma_coeffs":   a.coefficients.MA,
		"constant":    a.coefficients.C,
		"std_error":   a.calculateStdError(),
		"n_residuals": len(a.residuals),
	}
}
