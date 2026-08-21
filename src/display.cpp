#include "display.h"
#include "config.h"

#ifdef USE_LCD
  #include <Wire.h>
  #include <LiquidCrystal_I2C.h>
  static LiquidCrystal_I2C lcd(LCD_I2C_ADDRESS, 16, 2);
  static char line0[17];
  static char line1[17];
  static char prev0[17] = "";
  static char prev1[17] = "";
#endif

void displayInit(void) {
#ifdef USE_LCD
  lcd.init();
  lcd.backlight();
  lcd.clear();
#endif
}

void displaySplash(void) {
#ifdef USE_LCD
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Smart Dustbin");
  lcd.setCursor(0, 1); lcd.print(DEVICE_ID); lcd.print(" v"); lcd.print(FIRMWARE_V);
  delay(1500);
  lcd.clear();
#endif
}

/* --------------------------------------------------------------
 *  displayUpdate()
 *  Only writes when the text actually CHANGED. Re-drawing an I2C
 *  LCD 500 times a second floods the bus and makes the screen
 *  flicker - a classic beginner bug.
 * ------------------------------------------------------------ */
void displayUpdate(const char *lidState, float fillPercent, BinStatus status) {
#ifdef USE_LCD
  snprintf(line0, sizeof(line0), "Lid:%-8s%s", lidState, "");
  if (status == BIN_ERROR) {
    snprintf(line1, sizeof(line1), "SENSOR ERROR    ");
  } else {
    snprintf(line1, sizeof(line1), "Fill:%3d%% %-6s",
             (int)(fillPercent + 0.5f), binLevelStatusName(status));
  }

  if (strcmp(line0, prev0) != 0) {
    lcd.setCursor(0, 0); lcd.print(line0);
    strcpy(prev0, line0);
  }
  if (strcmp(line1, prev1) != 0) {
    lcd.setCursor(0, 1); lcd.print(line1);
    strcpy(prev1, line1);
  }
#else
  (void)lidState; (void)fillPercent; (void)status;   /* silence warnings */
#endif
}
