package capture

import "example.test/golden/internal/fossil"

func Use() int { return fossil.A{}.Missing() }
