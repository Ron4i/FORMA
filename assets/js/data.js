(function () {
  const Fit = (window.Fit = window.Fit || {});

  Fit.MUSCLE_GROUPS = [
    { id: "chest", label: "Грудь" },
    { id: "back", label: "Спина" },
    { id: "legs", label: "Ноги" },
    { id: "shoulders", label: "Плечи" },
    { id: "arms", label: "Руки" },
    { id: "core", label: "Пресс" },
    { id: "cardio", label: "Кардио" },
    { id: "fullbody", label: "Всё тело" }
  ];

  Fit.EQUIPMENT = [
    { id: "bodyweight", label: "Без оборудования" },
    { id: "dumbbell", label: "Гантели" },
    { id: "barbell", label: "Штанга" },
    { id: "kettlebell", label: "Гиря" },
    { id: "cable", label: "Блок" },
    { id: "machine", label: "Тренажёр" },
    { id: "band", label: "Резинка" },
    { id: "other", label: "Другое" }
  ];

  Fit.EXERCISES = [
    { id: "pushup", name: "Отжимания", muscle: "chest", equipment: "bodyweight", type: "strength", difficulty: "Начальный", instructions: "Руки на ширине плеч, тело прямое. Опускайтесь грудью к полу и выжимайте вверх." },
    { id: "squat", name: "Приседания", muscle: "legs", equipment: "bodyweight", type: "strength", difficulty: "Начальный", instructions: "Ноги на ширине плеч, спина прямая. Опускайтесь до параллели бёдер с полом." },
    { id: "lunge", name: "Выпады", muscle: "legs", equipment: "bodyweight", type: "strength", difficulty: "Начальный", instructions: "Шаг вперёд, согните оба колена под 90°. Чередуйте ноги." },
    { id: "plank", name: "Планка", muscle: "core", equipment: "bodyweight", type: "strength", difficulty: "Начальный", instructions: "Упор на локти и носки, тело прямое. Держите сколько возможно." },
    { id: "glute_bridge", name: "Ягодичный мост", muscle: "legs", equipment: "bodyweight", type: "strength", difficulty: "Начальный", instructions: "Лёжа на спине, поднимайте таз вверх, сжимая ягодицы." },
    { id: "pullup", name: "Подтягивания", muscle: "back", equipment: "bodyweight", type: "strength", difficulty: "Средний", instructions: "Хват сверху, подтягивайте грудь к перекладине." },
    { id: "dip", name: "Отжимания на брусьях", muscle: "arms", equipment: "bodyweight", type: "strength", difficulty: "Средний", instructions: "Опускайтесь, сгибая локти, затем выжимайте вверх." },
    { id: "mountain_climber", name: "Горные альпинисты", muscle: "core", equipment: "bodyweight", type: "cardio", difficulty: "Начальный", instructions: "В планке быстро подтягивайте колени к груди по очереди." },
    { id: "burpee", name: "Бёрпи", muscle: "fullbody", equipment: "bodyweight", type: "cardio", difficulty: "Средний", instructions: "Присед, упор, отжимание, прыжок вверх. Повторяйте." },
    { id: "situp", name: "Скручивания", muscle: "core", equipment: "bodyweight", type: "strength", difficulty: "Начальный", instructions: "Лёжа, поднимайте верх тела к коленям." },
    { id: "leg_raise", name: "Подъём ног", muscle: "core", equipment: "bodyweight", type: "strength", difficulty: "Начальный", instructions: "Лёжа, поднимайте прямые ноги вверх и опускайте." },
    { id: "calf_raise", name: "Подъём на носки", muscle: "legs", equipment: "bodyweight", type: "strength", difficulty: "Начальный", instructions: "Встаньте на носочки и опускайтесь." },
    { id: "jump_squat", name: "Прыжковые приседания", muscle: "legs", equipment: "bodyweight", type: "cardio", difficulty: "Средний", instructions: "Приседайте и выпрыгивайте вверх." },
    { id: "wall_sit", name: "Присед у стены", muscle: "legs", equipment: "bodyweight", type: "strength", difficulty: "Начальный", instructions: "Спиной к стене, ноги под 90°, держите." },
    { id: "diamond_pushup", name: "Отжимания алмаз", muscle: "arms", equipment: "bodyweight", type: "strength", difficulty: "Средний", instructions: "Руки треугольником под грудью, отжимайтесь." },
    { id: "chinup", name: "Подтягивания хватом к себе", muscle: "back", equipment: "bodyweight", type: "strength", difficulty: "Средний", instructions: "Хват снизу, подтягивайтесь." },
    { id: "pistol_squat", name: "Пистолет (присед на одной)", muscle: "legs", equipment: "bodyweight", type: "strength", difficulty: "Продвинутый", instructions: "Присед на одной ноге, вторая вперёд." },
    { id: "hollow_hold", name: "Холлоу холд", muscle: "core", equipment: "bodyweight", type: "strength", difficulty: "Средний", instructions: "Лёжа, оторвите плечи и ноги от пола, держите." },
    { id: "db_bench", name: "Жим гантелей лёжа", muscle: "chest", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Лёжа на скамье, жмите гантели вверх." },
    { id: "db_row", name: "Тяга гантели в наклоне", muscle: "back", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Наклон вперёд, тяните гантель к поясу." },
    { id: "db_shoulder_press", name: "Жим гантелей сидя", muscle: "shoulders", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Жмите гантели вверх над головой." },
    { id: "db_curl", name: "Сгибание рук с гантелями", muscle: "arms", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Сгибайте руки, не раскачивая корпус." },
    { id: "db_tricep_ext", name: "Разгибание гантели из-за головы", muscle: "arms", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Гантель за головой, разгибайте руки вверх." },
    { id: "db_lunge", name: "Выпады с гантелями", muscle: "legs", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Выпады с гантелями в руках." },
    { id: "db_rdl", name: "Румынская тяга с гантелями", muscle: "legs", equipment: "dumbbell", type: "strength", difficulty: "Средний", instructions: "Наклон с прямой спиной, тяните ягодицы назад." },
    { id: "db_fly", name: "Разведение гантелей", muscle: "chest", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Лёжа, разводите гантели в стороны дугой." },
    { id: "lateral_raise", name: "Махи в стороны", muscle: "shoulders", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Поднимайте гантели в стороны до уровня плеч." },
    { id: "front_raise", name: "Махи вперёд", muscle: "shoulders", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Поднимайте гантели вперёд до уровня плеч." },
    { id: "db_shrug", name: "Шраги с гантелями", muscle: "shoulders", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Поднимайте плечи вверх, задержите." },
    { id: "goblet_squat", name: "Гоблет присед", muscle: "legs", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Гантель у груди, приседайте." },
    { id: "db_step_up", name: "Запрыгивания на платформу", muscle: "legs", equipment: "dumbbell", type: "strength", difficulty: "Средний", instructions: "С гантелями шагайте на платформу." },
    { id: "hammer_curl", name: "Молотковые сгибания", muscle: "arms", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Сгибайте нейтральным хватом." },
    { id: "concentration_curl", name: "Концентрированный бицепс", muscle: "arms", equipment: "dumbbell", type: "strength", difficulty: "Начальный", instructions: "Локоть у бедра, медленно сгибайте." },
    { id: "renegade_row", name: "Ренегат-тяга", muscle: "back", equipment: "dumbbell", type: "strength", difficulty: "Продвинутый", instructions: "В планке на гантелях, тяните по очереди." },
    { id: "bb_squat", name: "Присед со штангой", muscle: "legs", equipment: "barbell", type: "strength", difficulty: "Средний", instructions: "Штанга на плечах, приседайте до параллели." },
    { id: "bb_bench", name: "Жим штанги лёжа", muscle: "chest", equipment: "barbell", type: "strength", difficulty: "Средний", instructions: "Лёжа, жмите штангу от груди вверх." },
    { id: "bb_deadlift", name: "Становая тяга", muscle: "back", equipment: "barbell", type: "strength", difficulty: "Продвинутый", instructions: "Тяните штангу от пола, спина прямая." },
    { id: "bb_row", name: "Тяга штанги в наклоне", muscle: "back", equipment: "barbell", type: "strength", difficulty: "Средний", instructions: "Наклон, тяните штангу к низу живота." },
    { id: "ohp", name: "Армейский жим", muscle: "shoulders", equipment: "barbell", type: "strength", difficulty: "Средний", instructions: "Жмите штангу вверх от плеч стоя." },
    { id: "bb_curl", name: "Сгибание со штангой", muscle: "arms", equipment: "barbell", type: "strength", difficulty: "Начальный", instructions: "Сгибайте штангу, локти у корпуса." },
    { id: "front_squat", name: "Фронтальный присед", muscle: "legs", equipment: "barbell", type: "strength", difficulty: "Продвинутый", instructions: "Штанга у ключиц, приседайте." },
    { id: "romanian_deadlift", name: "Румынская тяга", muscle: "legs", equipment: "barbell", type: "strength", difficulty: "Средний", instructions: "Наклон с прямой спиной, штанга по ногам." },
    { id: "bb_hip_thrust", name: "Ягодичный толчок со штангой", muscle: "legs", equipment: "barbell", type: "strength", difficulty: "Средний", instructions: "Лёжа, выжимайте таз со штангой." },
    { id: "good_morning", name: "Гуд морнинг", muscle: "legs", equipment: "barbell", type: "strength", difficulty: "Средний", instructions: "Наклоны вперёд со штангой на плечах." },
    { id: "lat_pulldown", name: "Тяга верхнего блока", muscle: "back", equipment: "cable", type: "strength", difficulty: "Начальный", instructions: "Тяните рукоять к груди." },
    { id: "cable_row", name: "Тяга блока к поясу", muscle: "back", equipment: "cable", type: "strength", difficulty: "Начальный", instructions: "Тяните рукоять к животу." },
    { id: "cable_fly", name: "Сведение в кроссовере", muscle: "chest", equipment: "cable", type: "strength", difficulty: "Начальный", instructions: "Сводите рукояти перед грудью." },
    { id: "tricep_pushdown", name: "Разгибание на блоке", muscle: "arms", equipment: "cable", type: "strength", difficulty: "Начальный", instructions: "Разгибайте руки на нижнем блоке." },
    { id: "face_pull", name: "Протяжка к лицу", muscle: "shoulders", equipment: "cable", type: "strength", difficulty: "Начальный", instructions: "Тяните рукоять к лицу, локти в стороны." },
    { id: "leg_press", name: "Жим ногами", muscle: "legs", equipment: "machine", type: "strength", difficulty: "Начальный", instructions: "Жмите платформу ногами." },
    { id: "leg_curl", name: "Сгибание ног", muscle: "legs", equipment: "machine", type: "strength", difficulty: "Начальный", instructions: "Сгибайте ноги в тренажёре." },
    { id: "leg_extension", name: "Разгибание ног", muscle: "legs", equipment: "machine", type: "strength", difficulty: "Начальный", instructions: "Разгибайте ноги в тренажёре." },
    { id: "cable_curl", name: "Сгибание на блоке", muscle: "arms", equipment: "cable", type: "strength", difficulty: "Начальный", instructions: "Сгибайте руки на нижнем блоке." },
    { id: "pec_deck", name: "Сведение в пек-деке", muscle: "chest", equipment: "machine", type: "strength", difficulty: "Начальный", instructions: "Сводите руки в тренажёре." },
    { id: "kb_swing", name: "Махи гирей", muscle: "fullbody", equipment: "kettlebell", type: "cardio", difficulty: "Средний", instructions: "Мах гири от пола до уровня глаз." },
    { id: "kb_goblet_squat", name: "Гоблет присед с гирей", muscle: "legs", equipment: "kettlebell", type: "strength", difficulty: "Начальный", instructions: "Гиря у груди, приседайте." },
    { id: "kb_turkish_getup", name: "Турецкий подъём", muscle: "fullbody", equipment: "kettlebell", type: "strength", difficulty: "Продвинутый", instructions: "Встаньте с пола, держа гирю над головой." },
    { id: "kb_deadlift", name: "Тяга гири", muscle: "legs", equipment: "kettlebell", type: "strength", difficulty: "Начальный", instructions: "Тяните гирю от пола." },
    { id: "running", name: "Бег", muscle: "cardio", equipment: "other", type: "cardio", difficulty: "Начальный", instructions: "Равномерный бег в комфортном темпе." },
    { id: "cycling", name: "Велосипед", muscle: "cardio", equipment: "other", type: "cardio", difficulty: "Начальный", instructions: "Катайтесь в умеренном темпе." },
    { id: "jump_rope", name: "Скакалка", muscle: "cardio", equipment: "other", type: "cardio", difficulty: "Начальный", instructions: "Прыгайте через скакалку." },
    { id: "rowing", name: "Гребля", muscle: "cardio", equipment: "machine", type: "cardio", difficulty: "Начальный", instructions: "Гребите на тренажёре." },
    { id: "elliptical", name: "Эллипсоид", muscle: "cardio", equipment: "machine", type: "cardio", difficulty: "Начальный", instructions: "Занимайтесь на эллипсоиде." },
    { id: "walk", name: "Ходьба", muscle: "cardio", equipment: "other", type: "cardio", difficulty: "Начальный", instructions: "Быстрая ходьба." },
    { id: "hiit", name: "ВИИТ", muscle: "cardio", equipment: "other", type: "cardio", difficulty: "Средний", instructions: "Интервалы: максимум/отдых." },
    { id: "band_pull_apart", name: "Разведение резинки", muscle: "shoulders", equipment: "band", type: "strength", difficulty: "Начальный", instructions: "Тяните резинку в стороны перед грудью." },
    { id: "band_rotation", name: "Ротация с резинкой", muscle: "core", equipment: "band", type: "strength", difficulty: "Начальный", instructions: "Ротация корпуса с резинкой." }
  ];

  Fit.PRESET_ROUTINES = [
    {
      id: "preset_fullbody",
      name: "Всё тело (начинающий)",
      preset: true,
      exercises: [
        { exerciseId: "squat", sets: 3, reps: 12, rest: 60 },
        { exerciseId: "pushup", sets: 3, reps: 10, rest: 60 },
        { exerciseId: "db_row", sets: 3, reps: 12, rest: 60 },
        { exerciseId: "plank", sets: 3, reps: 0, rest: 45, note: "секунд" },
        { exerciseId: "glute_bridge", sets: 3, reps: 15, rest: 45 }
      ]
    },
    {
      id: "preset_push",
      name: "День толкающих (грудь/плечи/трицепс)",
      preset: true,
      exercises: [
        { exerciseId: "bb_bench", sets: 4, reps: 8, rest: 90 },
        { exerciseId: "ohp", sets: 3, reps: 10, rest: 75 },
        { exerciseId: "db_fly", sets: 3, reps: 12, rest: 60 },
        { exerciseId: "tricep_pushdown", sets: 3, reps: 12, rest: 60 },
        { exerciseId: "lateral_raise", sets: 3, reps: 15, rest: 45 }
      ]
    },
    {
      id: "preset_pull",
      name: "День тянущих (спина/бицепс)",
      preset: true,
      exercises: [
        { exerciseId: "pullup", sets: 4, reps: 6, rest: 90 },
        { exerciseId: "bb_row", sets: 4, reps: 10, rest: 75 },
        { exerciseId: "lat_pulldown", sets: 3, reps: 12, rest: 60 },
        { exerciseId: "bb_curl", sets: 3, reps: 12, rest: 60 },
        { exerciseId: "face_pull", sets: 3, reps: 15, rest: 45 }
      ]
    },
    {
      id: "preset_legs",
      name: "День ног",
      preset: true,
      exercises: [
        { exerciseId: "bb_squat", sets: 4, reps: 8, rest: 120 },
        { exerciseId: "romanian_deadlift", sets: 3, reps: 10, rest: 90 },
        { exerciseId: "leg_press", sets: 3, reps: 12, rest: 75 },
        { exerciseId: "leg_curl", sets: 3, reps: 12, rest: 60 },
        { exerciseId: "calf_raise", sets: 4, reps: 15, rest: 45 }
      ]
    }
  ];

  Fit.getExercise = function (id) {
    return Fit.EXERCISES.find((e) => e.id === id);
  };

  Fit.FOODS = [
    { id: "chicken", name: "Куриная грудка", kcal: 165, p: 31, f: 3.6, c: 0 },
    { id: "rice", name: "Рис (варёный)", kcal: 130, p: 2.7, f: 0.3, c: 28 },
    { id: "oats", name: "Овсянка", kcal: 389, p: 17, f: 7, c: 66 },
    { id: "egg", name: "Яйцо", kcal: 155, p: 13, f: 11, c: 1.1 },
    { id: "banana", name: "Банан", kcal: 89, p: 1.1, f: 0.3, c: 23 },
    { id: "apple", name: "Яблоко", kcal: 52, p: 0.3, f: 0.2, c: 14 },
    { id: "broccoli", name: "Брокколи", kcal: 34, p: 2.8, f: 0.4, c: 7 },
    { id: "salmon", name: "Лосось", kcal: 208, p: 20, f: 13, c: 0 },
    { id: "beef", name: "Говядина", kcal: 250, p: 26, f: 15, c: 0 },
    { id: "potato", name: "Картофель", kcal: 77, p: 2, f: 0.1, c: 17 },
    { id: "pasta", name: "Макароны", kcal: 131, p: 5, f: 1.1, c: 25 },
    { id: "bread", name: "Хлеб", kcal: 265, p: 9, f: 3.2, c: 49 },
    { id: "yogurt", name: "Греческий йогурт", kcal: 59, p: 10, f: 0.4, c: 3.6 },
    { id: "milk", name: "Молоко", kcal: 42, p: 3.4, f: 1, c: 5 },
    { id: "pb", name: "Арахисовая паста", kcal: 588, p: 25, f: 50, c: 20 },
    { id: "almond", name: "Миндаль", kcal: 579, p: 21, f: 50, c: 22 },
    { id: "tuna", name: "Тунец", kcal: 132, p: 28, f: 1, c: 0 },
    { id: "avocado", name: "Авокадо", kcal: 160, p: 2, f: 15, c: 9 },
    { id: "orange", name: "Апельсин", kcal: 47, p: 0.9, f: 0.1, c: 12 },
    { id: "carrot", name: "Морковь", kcal: 41, p: 0.9, f: 0.2, c: 10 },
    { id: "beans", name: "Фасоль", kcal: 127, p: 8.7, f: 0.5, c: 23 },
    { id: "cottage", name: "Творог", kcal: 98, p: 11, f: 4.3, c: 3.4 },
    { id: "shake", name: "Протеиновый коктейль", kcal: 120, p: 25, f: 1.5, c: 3 },
    { id: "pizza", name: "Пицца", kcal: 266, p: 11, f: 10, c: 33 },
    { id: "burger", name: "Бургер", kcal: 295, p: 17, f: 14, c: 24 },
    { id: "chocolate", name: "Шоколад", kcal: 546, p: 4.9, f: 31, c: 61 },
    { id: "cola", name: "Кола", kcal: 42, p: 0, f: 0, c: 10.6 },
    { id: "juice", name: "Апельсиновый сок", kcal: 45, p: 0.7, f: 0.2, c: 10 },
    { id: "oil", name: "Оливковое масло", kcal: 884, p: 0, f: 100, c: 0 },
    { id: "whey", name: "Сывороточный протеин", kcal: 400, p: 80, f: 7, c: 8 }
  ];

  /* ============ FORMA: расширенные данные ============ */

  // Ориентировочные порции (г/мл) для типовых блюд — используются офлайн-эвристикой
  Fit.PORTION_HINTS = {
    "Куриная грудка": 150, "Рис (варёный)": 150, "Овсянка": 50, "Яйцо": 55, "Банан": 120,
    "Яблоко": 180, "Брокколи": 150, "Лосось": 140, "Говядина": 150, "Картофель": 150,
    "Макароны": 180, "Хлеб": 30, "Греческий йогурт": 170, "Молоко": 200, "Арахисовая паста": 20,
    "Миндаль": 25, "Тунец": 120, "Авокадо": 70, "Апельсин": 150, "Морковь": 100,
    "Фасоль": 150, "Творог": 150, "Протеиновый коктейль": 300, "Пицца": 120, "Бургер": 220,
    "Шоколад": 30, "Кола": 330, "Сывороточный протеин": 30
  };

  // Офлайн-база для распознавания по фото (эвристика, когда ИИ недоступен)
  Fit.VISION_HINTS = [
    { k: ["салат", "зелен", "огурец", "помидор", "овощ"], n: "Овощной салат", kcal: 90, p: 2.5, f: 5, c: 9 },
    { k: ["суп", "борщ", "щи", "сольян"], n: "Суп", kcal: 120, p: 6, f: 5, c: 14 },
    { k: ["гречка", "гречн"], n: "Гречка", kcal: 130, p: 5, f: 1.2, c: 25 },
    { k: ["плов", "рис"], n: "Рис с мясом", kcal: 210, p: 9, f: 7, c: 28 },
    { k: ["борщ"], n: "Борщ", kcal: 130, p: 5, f: 6, c: 14 },
    { k: ["блин", "блины", "сырник"], n: "Сырники", kcal: 240, p: 14, f: 12, c: 22 },
    { k: ["омлет", "яичниц"], n: "Омлет", kcal: 180, p: 13, f: 13, c: 3 },
    { k: ["каша", "овсян", "завтрак"], n: "Овсяная каша", kcal: 160, p: 6, f: 4, c: 26 },
    { k: ["смузи", "коктейль", "шейк"], n: "Смузи", kcal: 140, p: 6, f: 4, c: 20 },
    { k: ["суши", "ролл"], n: "Роллы", kcal: 200, p: 8, f: 4, c: 32 },
    { k: ["бургер", "гамбургер"], n: "Бургер", kcal: 300, p: 17, f: 15, c: 25 },
    { k: ["пицц"], n: "Пицца", kcal: 270, p: 11, f: 10, c: 33 },
    { k: ["шаурм", "шаверма", "бургерная"], n: "Шаурма", kcal: 340, p: 16, f: 20, c: 26 },
    { k: ["суп-крем", "пюре"], n: "Суп-пюре", kcal: 110, p: 3, f: 6, c: 11 },
    { k: ["мяс", "стейк", "говяд"], n: "Говядина", kcal: 250, p: 26, f: 15, c: 0 },
    { k: ["куриц", "куриная", "грудк"], n: "Куриная грудка", kcal: 165, p: 31, f: 3.6, c: 0 },
    { k: ["рыб", "лосос", "тунец", "треск"], n: "Рыба", kcal: 200, p: 22, f: 11, c: 0 },
    { k: ["творог", "йогурт"], n: "Творог с йогуртом", kcal: 110, p: 12, f: 4, c: 5 },
    { k: ["фрукт", "яблок", "банан", "груш"], n: "Фрукты", kcal: 60, p: 0.6, f: 0.3, c: 14 },
    { k: ["сахар", "сладк", "конфет", "шоколад", "торт"], n: "Сладкое", kcal: 380, p: 4, f: 18, c: 50 },
    { k: ["чай", "кофе", "напит"], n: "Напиток", kcal: 20, p: 0.3, f: 0, c: 4 }
  ];

  // Готовые рецепты для похудения
  Fit.RECIPES = [
    { id: "r1", n: "Куриный бульон с овощами", kcal: 320, p: 38, f: 8, c: 22, t: 25, tags: ["низкоуглеводный", "обед"], ing: "Куриное филе 200г, лук ½, морковь 1, зелень, вода" },
    { id: "r2", n: "Гречка с яйцом пашот", kcal: 380, p: 24, f: 9, c: 48, t: 20, tags: ["обед", "сытный"], ing: "Гречка 80г, яйцо 1, помидор 1" },
    { id: "r3", n: "Салат с тунцом и авокадо", kcal: 350, p: 32, f: 20, c: 12, t: 10, tags: ["обед", "высокобелковый"], ing: "Тунец 120г, авокадо ½, огурец, салат, лимон" },
    { id: "r4", n: "Овсянка на протеине с бананом", kcal: 400, p: 28, f: 8, c: 52, t: 8, tags: ["завтрак", "высокобелковый"], ing: "Овсянка 50г, банан 1, протеин 20г, корица" },
    { id: "r5", n: "Лосось с брокколи", kcal: 420, p: 40, f: 22, c: 14, t: 30, tags: ["ужин", "омега-3"], ing: "Лосось 150г, брокколи 200г, оливковое масло 5г" },
    { id: "r6", n: "Творожная запеканка", kcal: 300, p: 30, f: 9, c: 22, t: 35, tags: ["завтрак", "десерт"], ing: "Творог 200г, яйцо 1, мёд 1 ч.л." },
    { id: "r7", n: "Куриный суп с лапшой", kcal: 340, p: 30, f: 7, c: 36, t: 40, tags: ["обед", "уютно"], ing: "Курица 200г, лапша 50г, морковь, лук" },
    { id: "r8", n: "Фаршированный перец", kcal: 360, p: 32, f: 14, c: 24, t: 45, tags: ["ужин", "обед"], ing: "Перец 2, фарш 150г, рис 40г" },
    { id: "r9", n: "Греческий салат с сыром", kcal: 290, p: 18, f: 21, c: 8, t: 8, tags: ["обед", "лёгкий"], ing: "Овощи 250г, фета 50г, олив. масло 7г" },
    { id: "r10", n: "Протеиновые оладьи", kcal: 330, p: 34, f: 7, c: 30, t: 15, tags: ["завтрак", "высокобелковый"], ing: "Творог 150г, яйцо 1, овсянка 30г" }
  ];

  // Достижения
  Fit.BADGES = [
    { id: "first_workout", n: "Первый шаг", d: "Завершите первую тренировку", e: "🏋️", xp: 10 },
    { id: "streak3", n: "Три дня", d: "3 тренировки подряд", e: "🔥", xp: 20 },
    { id: "streak7", n: "Неделя", d: "7 тренировок подряд", e: "⚡", xp: 50 },
    { id: "streak30", n: "Месяц", d: "30 тренировок подряд", e: "👑", xp: 200 },
    { id: "scan10", n: "Сканер", d: "10 фоторазборов еды", e: "📸", xp: 30 },
    { id: "water7", n: "Гидратация", d: "7 дней нормы воды", e: "💧", xp: 30 },
    { id: "weigh10", n: "Взвешивание", d: "10 записей веса", e: "⚖️", xp: 20 },
    { id: "story1", n: "История", d: "Опубликуйте первую историю", e: "📸", xp: 15 },
    { id: "goal_reached", n: "Цель", d: "Достигните целевого веса", e: "🎯", xp: 300 },
    { id: "kcal_week", n: "Дисциплина", d: "7 дней в рамках нормы калорий", e: "🥗", xp: 100 }
  ];

  // Челленджи
  Fit.CHALLENGES = [
    { id: "c1", n: "Водный старт", d: "7 дней по 2 литра воды", e: "💧", unit: "дн.", goal: 7, xp: 100 },
    { id: "c2", n: "Белковый буст", d: "5 дней с 100г+ белка", e: "🥚", unit: "дн.", goal: 5, xp: 120 },
    { id: "c3", n: "Дефицит 14", d: "14 дней в калорийном дефиците", e: "🔥", unit: "дн.", goal: 14, xp: 250 },
    { id: "c4", n: "10000 шагов", d: "Достигните 10 000 шагов за день", e: "👟", unit: "дн.", goal: 7, xp: 150 }
  ];

  // Шаблоны уведомлений
  Fit.NOTIFY_TEMPLATES = [    { id: "water", n: "Вода", e: "💧", d: "Напоминание выпить воду", every: 120, min: 8, max: 21 },
    { id: "weigh", n: "Взвешивание", e: "⚖️", d: "Взвесьтесь утром натощак", every: 1440, min: 7, max: 8 },
    { id: "meal", n: "Питание", e: "🥗", d: "Не забудьте внести приём пищи", every: 360, min: 9, max: 21 },
    { id: "workout", n: "Тренировка", e: "🏋️", d: "Время тренироваться", every: 1440, min: 18, max: 20 },
    { id: "scancap", n: "Скан", e: "📸", d: "Сфотографируйте еду — 30 секунд", every: 720, min: 10, max: 20 },
    { id: "streak", n: "Серия", e: "🔥", d: "Не потеряйте серию тренировок", every: 1440, min: 19, max: 20 },
    { id: "inactive", n: "Малоподвижность", e: "🪑", d: "Встань и пройдись 5 минут", every: 180, min: 13, max: 18 }
  ];

  // Значки для сторис/лайков/поздравлений
  Fit.STORY_REACTIONS = ["🔥", "👏", "💪", "❤️", "😮", "🎉", "🙌", "🤯"];
  Fit.CHEERS = [
    "Ты невероятный! 🔥", "Так держать! 💪", "Вдохновляешь! 👏", "Горжусь тобой! ❤️",
    "Продолжай в том же духе! 🚀", "Это заслуженно! 🏆"
  ];

  /* ---------- Нормализация полей для UI ----------
     views_social.js ожидает читаемые имена (title/desc/min/e/bg/steps),
     а исторические записи используют короткие (n/d/t). Приводим к обоим. */
  Fit.BADGES.forEach((b) => {
    b.title = b.title || b.n;
    b.desc = b.desc || b.d;
    b.e = b.e || "🏅";
  });
  Fit.CHALLENGES.forEach((c) => {
    c.title = c.title || c.n;
    c.desc = c.desc || c.d;
    c.e = c.e || "🎯";
    if (!c.days) c.days = c.goal;
  });
  Fit.RECIPES.forEach((r) => {
    r.title = r.title || r.n;
    r.min = r.min || r.t || 20;
    r.e = r.e || "🍽️";
    r.bg = r.bg || "linear-gradient(135deg,#1f3a2e,#2d5a45)";
    r.steps = r.steps || ["Приготовьте ингредиенты по списку.", "Смешайте всё в миске, доведите до готовности."];
  });
})();
