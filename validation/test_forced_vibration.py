import numpy as np
from scipy.integrate import solve_ivp

# Structural properties
T = 1.0
zeta = 0.05
omega = 2 * np.pi / T

# Harmonic ground acceleration
A = 0.5
Omega = 1.5 * omega

# Analytical steady-state displacement amplitude
exact_amplitude = A / np.sqrt(
    (omega**2 - Omega**2)**2
    + (2 * zeta * omega * Omega)**2
)

# Numerical solution
def motion(time, state):
    u, v = state
    ag = A * np.sin(Omega * time)

    return [
        v,
        -2 * zeta * omega * v
        - omega**2 * u - ag
    ]

t = np.linspace(0, 100, 20001)

sol = solve_ivp(
    motion,
    (0, 100),
    [0.0, 0.0],
    t_eval=t,
    rtol=1e-9,
    atol=1e-11
)

if not sol.success:
    raise RuntimeError(sol.message)

# Compare after transient vibrations decay
steady = np.abs(sol.y[0][t >= 80])
numerical_amplitude = np.max(steady)

relative_error = (
    abs(numerical_amplitude - exact_amplitude)
    / exact_amplitude
)

print("FORCED VIBRATION VALIDATION")
print("--------------------------")
print("Analytical amplitude:", round(exact_amplitude, 8), "m")
print("Numerical amplitude:", round(numerical_amplitude, 8), "m")
print("Relative error:", round(relative_error * 100, 6), "%")
print("Tolerance: 0.1%")
print("Result:", "PASS" if relative_error < 0.001 else "FAIL")

if relative_error >= 0.001:
    raise SystemExit("Validation failed")
