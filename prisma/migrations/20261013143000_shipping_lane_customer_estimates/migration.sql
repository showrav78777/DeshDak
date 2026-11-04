-- Planning estimates are never used as a payable shipping quote. They let a
-- customer compare an origin-to-destination lane before the warehouse records
-- actual and volumetric measurements.
ALTER TABLE "ShippingLane"
  ADD COLUMN "estimatedRatePerKgBdt" DECIMAL(12, 2),
  ADD COLUMN "estimatedLastMileRatePerKgBdt" DECIMAL(12, 2),
  ADD COLUMN "estimatedHandlingFeeBdt" DECIMAL(12, 2),
  ADD COLUMN "estimatedMinimumChargeBdt" DECIMAL(12, 2);
