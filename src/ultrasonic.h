/**************************************************************
 *  File   : ultrasonic.h
 *  Purpose: Driver for the HC-SR04 ultrasonic distance sensor.
 *
 *  HOW THE SENSOR WORKS
 *  1. We send a 10 microsecond HIGH pulse on TRIG.
 *  2. The sensor emits 8 bursts of 40 kHz sound.
 *  3. ECHO goes HIGH and stays HIGH until the echo returns.
 *  4. We measure that HIGH time with pulseIn().
 *
 *  distance_cm = (echo_time_us * speed_of_sound) / 2
 *              = echo_time_us / 58.0
 *  We divide by 2 because the sound travels there AND back.
 **************************************************************/
#ifndef ULTRASONIC_H
#define ULTRASONIC_H

#include <Arduino.h>

/* A tiny "class-like" struct so we can have TWO sensors
   without duplicating any code. */
typedef struct {
  uint8_t trigPin;
  uint8_t echoPin;
  float   lastGood;   // remembered value, used if a ping fails
} Ultrasonic;

void  ultrasonicInit(Ultrasonic *s, uint8_t trigPin, uint8_t echoPin);
float ultrasonicReadRaw(Ultrasonic *s);      // one ping, may fail
float ultrasonicReadFiltered(Ultrasonic *s); // median-of-N, robust
bool  ultrasonicIsValid(float cm);

#endif /* ULTRASONIC_H */
